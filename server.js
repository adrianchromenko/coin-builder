'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { getProvider } = require('./lib/providers');
const { PURPOSES, normalizePurpose, freeText, quotedPhrases } = require('./lib/prompt');
const { countReferences } = require('./lib/references');
const { SIZES, hasPricing, estimate } = require('./lib/pricing');
const { saveOrder, updateOrder, notifyWebhook, createCheckout } = require('./lib/orders');
const { watermark, saveOriginal, readOriginal } = require('./lib/watermark');
const { mailConfigured, sendOrderEmail, sendAlertEmail, sendContactEmail, saveLead, readSignupsCsv, notifyLead } = require('./lib/mailer');
const guard = require('./lib/guard');
const { sideBySide } = require('./lib/composite');
const { siteUrl } = require('./lib/site');

const app = express();
const PORT = process.env.PORT || 3000;
const ORDER_RATE_LIMIT = Number(process.env.ORDER_LIMIT_PER_HOUR || 20);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 }, // front and, for a two-sided coin, back
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpe?g|webp)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Please upload a PNG, JPG, or WEBP image.'), ok);
  },
});

// Simple in-memory rate limit per IP for order submissions. AI renders are guarded separately in lib/guard.js.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => t > windowStart);
  if (list.length >= ORDER_RATE_LIMIT) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  return false;
}

app.set('trust proxy', 1);
guard.onAlert(sendAlertEmail);

// ---------- the page, share previews and search engines ----------
// index.html is a template: {{SITE_URL}} becomes the deployment's address so the canonical link and the
// share-preview (Open Graph / Twitter) tags are absolute, as Facebook, LinkedIn, iMessage and Google require.
// {{SHARE_VERSION}} changes whenever share.jpg does, so social networks fetch the new card instead of a cached one.
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');
const SHARE_VERSION = (() => {
  try { return crypto.createHash('sha1').update(fs.readFileSync(path.join(PUBLIC_DIR, 'share.jpg'))).digest('hex').slice(0, 8); } catch (_) { return '1'; }
})();
let indexCache = { mtime: 0, html: '' };
function renderIndex(req) {
  const mtime = fs.statSync(INDEX_FILE).mtimeMs;
  if (mtime !== indexCache.mtime) indexCache = { mtime, html: fs.readFileSync(INDEX_FILE, 'utf8') };
  return indexCache.html.replace(/\{\{SITE_URL\}\}/g, siteUrl(req)).replace(/\{\{SHARE_VERSION\}\}/g, SHARE_VERSION);
}
app.get(['/', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.type('html').send(renderIndex(req));
});
// Only the builder page is meant to be indexed. Everything else the server answers is data, admin, or staff-only.
app.use((req, res, next) => {
  if (/^\/(api|signups\.csv|healthz|test)(\/|$)/.test(req.path)) res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /signups.csv',
    'Disallow: /healthz',
    'Disallow: /test',
    '',
    `Sitemap: ${siteUrl(req)}/sitemap.xml`,
    '',
  ].join('\n'));
});
app.get('/sitemap.xml', (req, res) => {
  const lastmod = new Date(Math.max(fs.statSync(INDEX_FILE).mtimeMs, fs.statSync(path.join(PUBLIC_DIR, 'app.js')).mtimeMs)).toISOString().slice(0, 10);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${siteUrl(req)}/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
    <image:image>
      <image:loc>${siteUrl(req)}/share.jpg</image:loc>
      <image:title>Custom Coin Builder by Coins For Anything</image:title>
    </image:image>
  </url>
</urlset>
`);
});

app.use(express.static(PUBLIC_DIR, {
  index: false, // "/" is rendered above so the share tags carry the right address
  setHeaders: (res, filePath) => {
    // Always revalidate the app files so a plain refresh picks up changes
    if (/\.(html|js|css|webmanifest)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    // Icons and the share card change rarely and carry a version in the URL when they do
    else if (/\.(ico|png|jpg|webp)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=86400');
  },
}));
app.use(express.json({ limit: '12mb' }));

app.get('/api/config', (_req, res) => {
  const provider = getProvider();
  res.json({
    provider: provider.name,
    purposes: Object.fromEntries(Object.entries(PURPOSES).map(([k, v]) => [k, v.label])),
    references: countReferences(),
    sizes: SIZES,
    pricing: hasPricing(),
    payments: !!(process.env.STRIPE_SECRET_KEY && hasPricing()),
    // TEST_MODE=1 turns test mode on for everyone; otherwise it is enabled per browser with ?test=1
    testMode: process.env.TEST_MODE === '1',
    // true when SMTP is set up: designs are emailed instead of downloaded
    // set when Cloudflare Turnstile guards renders; the page then sends a token with every render
    turnstileSiteKey: guard.turnstileOn() ? process.env.TURNSTILE_SITE_KEY : '',
  });
});

app.get('/api/quote', (req, res) => {
  const size = String(req.query.size || '');
  const quantity = parseInt(req.query.quantity, 10);
  if (!SIZES.includes(size) || !quantity || quantity < 1) {
    return res.status(400).json({ error: 'Invalid size or quantity.' });
  }
  res.json({ estimate: estimate(size, quantity) });
});

app.post('/api/orders', async (req, res) => {
  const b = req.body || {};
  const quantity = parseInt(b.quantity, 10);
  const size = String(b.size || '');
  const name = String(b.name || '').trim().slice(0, 120);
  const email = String(b.email || '').trim().slice(0, 200);
  const phone = String(b.phone || '').trim().slice(0, 40);
  const notes = String(b.notes || '').trim().slice(0, 1000);
  const company = String(b.company || '').trim().slice(0, 160);
  const street = String(b.street || '').trim().slice(0, 200);
  const cityStateZip = String(b.cityStateZip || '').trim().slice(0, 120);
  const country = String(b.country || '').trim().slice(0, 80);
  const billStreet = String(b.billStreet || '').trim().slice(0, 200);
  const billCityStateZip = String(b.billCityStateZip || '').trim().slice(0, 120);
  const billCountry = String(b.billCountry || '').trim().slice(0, 80);
  // Test orders: saved for inspection, but never sent to Stripe or the order webhook
  const isTest = b.test === true || process.env.TEST_MODE === '1';
  // What the customer described, plus whether and how the AI rendered it
  const d = b.design && typeof b.design === 'object' ? b.design : {};
  const design = {
    ...describedDesign(d),
    logoName: String(d.logoName || '').trim().slice(0, 120),
    aiRendered: d.aiRendered === true,
    aiVersion: Number.isInteger(d.aiVersion) ? d.aiVersion : null,
    renderId: /^[0-9a-f]{32}$/.test(String(d.renderId || '')) ? d.renderId : null,
    aiVersionsMade: Number.isInteger(d.aiVersionsMade) ? d.aiVersionsMade : 0,
    // true / false from the proofreader, null when the render was not checked or there was no render
    aiWordingChecked: typeof d.aiWordingChecked === 'boolean' ? d.aiWordingChecked : null,
  };
  design.purposeLabel = design.purpose ? PURPOSES[design.purpose].label : '';
  if (!design.front) return res.status(400).json({ error: 'Please describe the front of your coin.' });

  if (!quantity || quantity < 1 || quantity > 100000) return res.status(400).json({ error: 'Please enter a valid quantity.' });
  if (!SIZES.includes(size)) return res.status(400).json({ error: 'Please choose a valid coin size.' });
  if (!name) return res.status(400).json({ error: 'Please tell us your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!street || !cityStateZip || !country) return res.status(400).json({ error: 'Please enter a complete shipping address.' });
  if (!billStreet || !billCityStateZip || !billCountry) return res.status(400).json({ error: 'Please enter a complete billing address.' });
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });

  try {
    // An AI version is ordered by its id, and staff get the clean original from the server's own copy;
    // the browser only ever had the watermarked preview. Layout orders send their flat mock-up as before.
    const original = readOriginal(d.renderId);
    const imageDataUrl = original ? `data:image/png;base64,${original.toString('base64')}` : (typeof b.image === 'string' ? b.image : '');
    const record = saveOrder({
      finishLabel: 'Challenge',
      size,
      quantity,
      name,
      email,
      phone,
      company,
      billing: { street: billStreet, cityStateZip: billCityStateZip, country: billCountry },
      shipping: { street, cityStateZip, country },
      notes,
      design,
      estimate: estimate(size, quantity),
      image: imageDataUrl,
      ip: req.ip,
      test: isTest,
    });
    console.log(`[coin-builder] ${isTest ? 'TEST order' : 'order'} ${record.id}: ${quantity} x ${size}" for ${email}`);

    if (isTest) {
      return res.json({ ok: true, orderId: record.id, estimate: record.estimate, checkoutUrl: null, test: true });
    }

    let checkoutUrl = null;
    try {
      checkoutUrl = await createCheckout(record, siteUrl(req));
    } catch (e) {
      console.error('[coin-builder] stripe error:', e.message);
    }

    notifyWebhook({ ...record, checkoutUrl });
    // Tell the team. The order is already saved on disk, so a mail problem never loses it (or fails the customer)
    const m = /^data:image\/png;base64,(.+)$/i.exec(imageDataUrl);
    sendOrderEmail(record, m ? Buffer.from(m[1], 'base64') : null)
      .then((r) => { if (r) console.log(`[coin-builder] order ${record.id} emailed to the team`); })
      .catch((e) => console.error(`[coin-builder] order email failed for ${record.id}:`, e.message));
    res.json({ ok: true, orderId: record.id, estimate: record.estimate, checkoutUrl });
  } catch (e) {
    console.error('[coin-builder] order error:', e.message);
    res.status(500).json({ error: 'Sorry, I could not save your order. Please try again.' });
  }
});

// Test checkout: only TEST- orders, only the last 4 digits are ever sent or stored
app.post('/api/orders/:id/test-payment', (req, res) => {
  const id = String(req.params.id || '');
  if (!/^TEST-\d{8}-[0-9A-F]{6}$/.test(id)) return res.status(400).json({ error: 'Not a test order' });
  const b = req.body || {};
  const paid = b.paid === true;
  const last4 = String(b.last4 || '').replace(/\D/g, '').slice(-4);
  const brand = String(b.brand || '').slice(0, 20);
  const rec = updateOrder(id, paid
    ? { status: 'test_paid', testPayment: { last4, brand, paidAt: new Date().toISOString() } }
    : { status: 'test_payment_cancelled' });
  if (!rec) return res.status(404).json({ error: 'Order not found' });
  console.log(`[coin-builder] TEST payment ${paid ? 'completed' : 'cancelled'} for ${id}`);
  res.json({ ok: true, status: rec.status });
});

app.post('/api/orders/:id/paid', (req, res) => {
  // Called by the page after returning from Stripe. Real confirmation should
  // come from a Stripe webhook; this just marks the return so staff can verify.
  const id = String(req.params.id || '');
  if (!/^CFA-\d{8}-[0-9A-F]{6}$/.test(id)) return res.status(400).json({ error: 'Bad order id' });
  const rec = updateOrder(id, { status: req.body && req.body.paid ? 'paid_pending_verification' : 'payment_cancelled' });
  if (!rec) return res.status(404).json({ error: 'Order not found' });
  res.json({ ok: true });
});

// The coin as the customer describes it: what it is for, their words for each face, style notes, and an optional logo.
// Each face is rendered on its own; the front's description is required. An empty back means the back is the
// same design as the front, so the front render is reused for it and no second render is paid for.
function describedDesign(body) {
  return {
    purpose: normalizePurpose(body.purpose),
    style: freeText(body.style, 300),
    front: freeText(body.front, 600),
    back: freeText(body.back, 600),
  };
}

// Proofreading results of the two sides, folded into one report for the badge under the coin
function mergeChecks(front, back) {
  const both = [front, back];
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const logos = both.map((c) => num(c.logoMatch)).filter((v) => v !== null);
  return {
    checked: both.every((c) => c.checked),
    ok: both.every((c) => !c.checked || c.ok) && both.some((c) => c.checked),
    textOk: both.every((c) => c.textOk !== false),
    logoOk: both.every((c) => c.logoOk !== false),
    borderOk: null,
    lines: [...(front.lines || []).map((l) => ({ ...l, where: `front ${l.where}` })), ...(back.lines || []).map((l) => ({ ...l, where: `back ${l.where}` }))],
    extraText: [...(front.extraText || []), ...(back.extraText || [])],
    logoMatch: logos.length ? Math.min(...logos) : null,
    logoIssues: [front.logoIssues, back.logoIssues].filter(Boolean).join('; '),
    sides: [front, back],
  };
}

app.post('/api/generate', (req, res) => {
  upload.single('logo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const logo = req.file ? { buffer: req.file.buffer, mimetype: req.file.mimetype } : null;
    const design = describedDesign(req.body || {});
    if (!design.front) return res.status(400).json({ error: 'Please describe the front of your coin first.' });
    const ownBack = !!design.back; // described separately, so it gets its own render
    const sides = [{ sideName: 'front', description: design.front }, ...(ownBack ? [{ sideName: 'back', description: design.back }] : [])];

    // Every render below this line costs money, so the cheap checks come first.
    // 1. The very same description and logo were rendered recently: hand back that result for free.
    const key = guard.fingerprint(logo ? logo.buffer : Buffer.alloc(0), design);
    const repeat = guard.cached(key);
    if (repeat) {
      console.log('[coin-builder] repeat render served from cache');
      return res.json(repeat);
    }
    // 2. Real browser? (only when Turnstile is configured)
    if (!(await guard.verifyTurnstile(req.body.turnstile, req.ip))) {
      return res.status(403).json({ error: 'We could not confirm this request came from a browser. Please reload the page and try again.' });
    }
    // 3. Per-visitor and site-wide limits. From here on the render is counted, so release() must run.
    const gate = guard.admit(req.ip, sides.length);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    try {
      const provider = getProvider();
      const started = Date.now();
      const results = await Promise.all(sides.map((side) => provider.generate({ mode: 'described', logo, purpose: design.purpose, style: design.style, ...side })));
      const attempts = results.reduce((n, r) => n + r.attempts, 0);
      console.log(`[coin-builder] ${provider.name} generated ${ownBack ? 'two-sided ' : 'same-both-sides '}described coin (${design.purpose || 'no purpose'}) in ${Date.now() - started}ms, ${attempts} attempt(s), model ${results[0].model}, ${guard.limits().usedToday}/${guard.limits().perDayTotal} renders today`);

      // The clean render stays on the server. The browser gets a small, lightly watermarked preview; the download
      // endpoint below hands out a heavily watermarked full-size copy. If watermarking fails, nothing is sent.
      // The finished photo always shows both faces: the back's own render, or the front again when the back was not described.
      let image, renderId = null, mimetype = results[0].mimetype, composed = false;
      if (results[0].mimetype === 'image/png' || ownBack) {
        composed = true;
        const faces = results.map((r) => Buffer.from(r.base64, 'base64'));
        const clean = await sideBySide(faces[0], ownBack ? faces[1] : faces[0]);
        mimetype = 'image/png';
        const preview = await watermark(clean, { strength: 'preview', size: 1400 });
        renderId = saveOriginal(clean);
        image = `data:image/png;base64,${preview.toString('base64')}`;
      } else {
        image = `data:${mimetype};base64,${results[0].base64}`;
      }
      const response = {
        provider: provider.name,
        twoSided: composed, // the photo shows both faces (the demo provider's single drawing is the exception)
        sameBack: !ownBack, // the back is the front design again
        image,
        renderId,
        // Proofreading result: which quoted wording matched, how well the logo held up (both sides folded together)
        check: ownBack ? mergeChecks(results[0].check, results[1].check) : results[0].check,
        phrases: { front: quotedPhrases(design.front), back: quotedPhrases(design.back) },
        attempts,
      };
      if (provider.name !== 'demo') guard.remember(key, response);
      res.json(response);
    } catch (e) {
      console.error('[coin-builder] generation error:', e.message);
      res.status(502).json({ error: 'Sorry, I could not generate the coin right now. Please try again.' });
    } finally {
      guard.release(req.ip);
    }
  });
});

// Full-size download of a render: always the heavily watermarked copy, made fresh from the clean original
const downloads = new Map();
app.get('/api/renders/:id/download', async (req, res) => {
  // With email set up, designs go to an inbox in exchange for an address; this door stays shut so nobody walks around that
  if (mailConfigured()) return res.status(403).json({ error: 'Designs are sent by email.' });
  const now = Date.now();
  const recent = (downloads.get(req.ip) || []).filter((t) => t > now - 3600000);
  if (recent.length >= 60) return res.status(429).json({ error: 'Too many downloads. Please try again later.' });
  downloads.set(req.ip, [...recent, now]);
  const clean = readOriginal(req.params.id);
  if (!clean) return res.status(404).json({ error: 'That render is no longer available. Please make a new version.' });
  try {
    const marked = await watermark(clean, { strength: 'download' });
    res.set({ 'Content-Type': 'image/png', 'Content-Disposition': 'attachment; filename="coins-for-anything-preview.png"', 'Cache-Control': 'private, no-store' });
    res.send(marked);
  } catch (e) {
    console.error('[coin-builder] watermark error:', e.message);
    res.status(500).json({ error: 'Sorry, the download could not be prepared.' });
  }
});

// "Email me this design": the customer leaves an address, we send the watermarked design and keep the lead.
// This endpoint sends mail because a stranger asked it to, so it is limited per visitor,
// and whatever image is involved is watermarked here, on the server, before it goes anywhere.
const mailsByIp = new Map();
function tooMany(map, key, max) {
  const now = Date.now();
  const recent = (map.get(key) || []).filter((t) => t > now - 3600000);
  if (recent.length >= max) { map.set(key, recent); return true; }
  map.set(key, [...recent, now]);
  return false;
}


// "Contact us to fix my design": the message, the design in the customer's words and their latest render go to the team.
// Mail sent on a stranger's say-so, so it is limited per visitor like the design emails.
app.post('/api/contact', async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  const name = String(b.name || '').replace(/[\r\n<>]/g, ' ').trim().slice(0, 80);
  const phone = String(b.phone || '').replace(/[\r\n<>]/g, ' ').trim().slice(0, 40);
  const message = String(b.message || '').replace(/[\u0000-\u0008\u000b-\u001f<>]/g, ' ').trim().slice(0, 1500);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!message) return res.status(400).json({ error: 'Please tell us what you would like changed.' });
  const isTest = b.test === true || process.env.TEST_MODE === '1';
  const design = describedDesign(b.design && typeof b.design === 'object' ? b.design : {});
  design.logoName = String((b.design && b.design.logoName) || '').trim().slice(0, 120);
  design.purposeLabel = design.purpose ? PURPOSES[design.purpose].label : '';
  const original = readOriginal(b.renderId);
  const lead = { email, name, phone, newsletter: false, test: isTest, ip: req.ip, renderId: original ? b.renderId : null, source: 'contact', message, design };
  try {
    if (isTest) {
      saveLead({ ...lead, emailed: false });
      return res.json({ ok: true, sent: false, test: true });
    }
    if (tooMany(mailsByIp, req.ip, Number(process.env.MAIL_LIMIT_PER_HOUR || 6))) {
      return res.status(429).json({ error: 'That is a lot of messages in a short time. Please try again in an hour, or call us at 1-866-583-5434.' });
    }
    const image = original ? await watermark(original, { strength: 'download', size: 1600 }) : null;
    const sent = await sendContactEmail({ name, email, phone, message, design, image });
    const record = saveLead({ ...lead, emailed: !!sent });
    notifyLead(record);
    console.log(`[coin-builder] design help request from ${email}${sent ? ' emailed to the team' : ' saved (mail not configured)'}`);
    res.json({ ok: true, sent: !!sent });
  } catch (e) {
    console.error('[coin-builder] contact error:', e.message);
    res.status(502).json({ error: 'Sorry, we could not send your message just now. Please try again, or call us at 1-866-583-5434.' });
  }
});

// Staff: the list of everyone who asked for their design by email, as a spreadsheet.
// Open /signups.csv?key=<ADMIN_KEY>. Off entirely unless ADMIN_KEY is set.
app.get('/signups.csv', (req, res) => {
  const key = process.env.ADMIN_KEY || '';
  const given = String(req.query.key || '');
  const ok = key.length >= 8 && given.length === key.length && require('crypto').timingSafeEqual(Buffer.from(given), Buffer.from(key));
  if (!ok) return res.status(404).end();
  const csv = readSignupsCsv() || 'date,name,email,newsletter,emailed,top text,center text,bottom text\r\n';
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="coin-builder-signups.csv"', 'Cache-Control': 'private, no-store' });
  res.send(csv);
});

app.get('/healthz', (_req, res) => res.send('ok'));

// Shortcut: /test turns test mode on for this browser tab, /test/off turns it off
app.get('/test', (_req, res) => res.redirect('/?test=1'));
app.get('/test/off', (_req, res) => res.redirect('/?test=0'));

// Start on PORT; if it is busy, try the next few ports instead of crashing.
function listen(port, attemptsLeft) {
  const server = app.listen(port, () => {
    if (port !== Number(PORT)) console.log(`[coin-builder] port ${PORT} was busy, using ${port} instead`);
    console.log(`Coin Builder running on http://localhost:${port} (provider: ${getProvider().name}, reference coins: ${countReferences()})`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.warn(`[coin-builder] port ${port} in use, trying ${port + 1}...`);
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error('[coin-builder] failed to start:', err.message);
      process.exit(1);
    }
  });
}

listen(Number(PORT), 10);
