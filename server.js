'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const multer = require('multer');
const { getProvider } = require('./lib/providers');
const { FINISHES, COLORS, SHAPES, ADDONS, normalizeFinish, normalizeColor, normalizeShape, normalizeAddons, normalizeBorder, normalizeTexts, normalizeBackground, finishLabel } = require('./lib/prompt');
const { countReferences } = require('./lib/references');
const { SIZES, hasPricing, estimate } = require('./lib/pricing');
const { saveOrder, updateOrder, notifyWebhook, createCheckout } = require('./lib/orders');
const { watermark, saveOriginal, readOriginal } = require('./lib/watermark');
const { mailConfigured, sendDesignEmail, readMailImage, saveLead, notifyLead } = require('./lib/mailer');

const app = express();
const PORT = process.env.PORT || 3000;
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR || 20);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpe?g|webp)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Please upload a PNG, JPG, or WEBP image.'), ok);
  },
});

// Simple in-memory rate limit per IP
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => t > windowStart);
  if (list.length >= RATE_LIMIT) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  return false;
}

app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // Always revalidate the app files so a plain refresh picks up changes
    if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  },
}));
app.use(express.json({ limit: '12mb' }));

app.get('/api/config', (_req, res) => {
  const provider = getProvider();
  res.json({
    provider: provider.name,
    finishes: Object.keys(FINISHES),
    colors: Object.keys(COLORS),
    shapes: Object.keys(SHAPES),
    addons: Object.keys(ADDONS),
    references: countReferences(),
    sizes: SIZES,
    pricing: hasPricing(),
    payments: !!(process.env.STRIPE_SECRET_KEY && hasPricing()),
    // TEST_MODE=1 turns test mode on for everyone; otherwise it is enabled per browser with ?test=1
    testMode: process.env.TEST_MODE === '1',
    // true when SMTP is set up: designs are emailed instead of downloaded
    emailDesigns: mailConfigured(),
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
  const finish = normalizeFinish(b.finish);
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
  // What the customer built: rim/center text, rim style, logo file name, whether AI rendered it
  const d = b.design && typeof b.design === 'object' ? b.design : {};
  const design = {
    topText: String(d.topText || '').trim().slice(0, 60),
    bottomText: String(d.bottomText || '').trim().slice(0, 60),
    centerText: String(d.centerText || '').trim().slice(0, 60),
    border: String(d.border || '').trim().slice(0, 20),
    color: normalizeColor(d.color),
    shape: normalizeShape(d.shape),
    addons: normalizeAddons(d.addons),
    // center background: enamel color (hex + name) and / or a struck texture
    background: normalizeBackground({ color: d.bgColor, colorName: d.bgColorName, texture: d.bgTexture }),
    logoName: String(d.logoName || '').trim().slice(0, 120),
    aiRendered: d.aiRendered === true,
    aiVersion: Number.isInteger(d.aiVersion) ? d.aiVersion : null,
    renderId: /^[0-9a-f]{32}$/.test(String(d.renderId || '')) ? d.renderId : null,
    aiVersionsMade: Number.isInteger(d.aiVersionsMade) ? d.aiVersionsMade : 0,
    // true / false from the proofreader, null when the render was not checked or the layout was ordered
    aiWordingChecked: typeof d.aiWordingChecked === 'boolean' ? d.aiWordingChecked : null,
  };
  // The same choices as they are worded on the coinsforanything.com quote form
  design.colorLabel = COLORS[design.color].label;
  design.shapeLabel = SHAPES[design.shape].label;
  design.addonLabels = design.addons.map((k) => ADDONS[k].label);

  if (!quantity || quantity < 1 || quantity > 100000) return res.status(400).json({ error: 'Please enter a valid quantity.' });
  if (!SIZES.includes(size)) return res.status(400).json({ error: 'Please choose a valid coin size.' });
  if (!name) return res.status(400).json({ error: 'Please tell us your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!street || !cityStateZip || !country) return res.status(400).json({ error: 'Please enter a complete shipping address.' });
  if (!billStreet || !billCityStateZip || !billCountry) return res.status(400).json({ error: 'Please enter a complete billing address.' });
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });

  try {
    const record = saveOrder({
      finish,
      finishLabel: finishLabel(finish),
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
      // An AI version is ordered by its id, and staff get the clean original from the server's own copy;
      // the browser only ever had the watermarked preview. Layout orders send their flat mock-up as before.
      image: (() => {
        const original = readOriginal(d.renderId);
        if (original) return `data:image/png;base64,${original.toString('base64')}`;
        return typeof b.image === 'string' ? b.image : '';
      })(),
      ip: req.ip,
      test: isTest,
    });
    console.log(`[coin-builder] ${isTest ? 'TEST order' : 'order'} ${record.id}: ${quantity} x ${size}" ${finish} for ${email}`);

    if (isTest) {
      return res.json({ ok: true, orderId: record.id, estimate: record.estimate, checkoutUrl: null, test: true });
    }

    let checkoutUrl = null;
    try {
      const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
      checkoutUrl = await createCheckout(record, baseUrl);
    } catch (e) {
      console.error('[coin-builder] stripe error:', e.message);
    }

    notifyWebhook({ ...record, checkoutUrl });
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

app.post('/api/generate', (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image received.' });
    if (rateLimited(req.ip)) {
      return res.status(429).json({ error: 'Too many coins generated. Please try again in a little while.' });
    }

    const finish = normalizeFinish(req.body.finish);
    const color = normalizeColor(req.body.color);
    const shape = normalizeShape(req.body.shape);
    const addons = normalizeAddons(req.body.addons);
    const texts = normalizeTexts({ top: req.body.topText, bottom: req.body.bottomText, center: req.body.centerText });
    const border = normalizeBorder(req.body.border);
    const hasLogo = req.body.hasLogo === '1' || req.body.hasLogo === 'true';
    const centerFirstLineWords = Math.max(0, parseInt(req.body.centerFirstLineWords, 10) || 0);
    const background = normalizeBackground({ color: req.body.bgColor, colorName: req.body.bgColorName, texture: req.body.bgTexture });

    // DEBUG_PROOF_DIR=some/folder saves the art proof exactly as the AI receives it, for troubleshooting a bad render
    if (process.env.DEBUG_PROOF_DIR) {
      try { require('fs').writeFileSync(path.join(process.env.DEBUG_PROOF_DIR, `proof-${Date.now()}.png`), req.file.buffer); } catch (_) {}
    }

    try {
      const provider = getProvider();
      const started = Date.now();
      const result = await provider.generate({
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        finish,
        color,
        shape,
        addons,
        texts,
        hasLogo,
        border,
        background,
        centerFirstLineWords,
      });
      console.log(`[coin-builder] ${provider.name} generated coin (${[finish, color, shape, ...addons].join(', ')}) in ${Date.now() - started}ms, ${result.attempts} attempt(s), model ${result.model}`);
      // The clean render stays on the server. The browser gets a small, lightly watermarked preview; the download
      // endpoint below hands out a heavily watermarked full-size copy. If watermarking fails, nothing is sent.
      let image = `data:${result.mimetype};base64,${result.base64}`;
      let renderId = null;
      if (result.mimetype === 'image/png') {
        const clean = Buffer.from(result.base64, 'base64');
        const preview = await watermark(clean, { strength: 'preview', size: 768 });
        renderId = saveOriginal(clean);
        image = `data:image/png;base64,${preview.toString('base64')}`;
      }
      res.json({
        provider: provider.name,
        finish,
        image,
        renderId,
        // Proofreading result: which lettering matched, stray text, how well the logo held up
        check: result.check,
        attempts: result.attempts,
      });
    } catch (e) {
      console.error('[coin-builder] generation error:', e.message);
      res.status(502).json({ error: 'Sorry, I could not generate the coin right now. Please try again.' });
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
// This endpoint sends mail because a stranger asked it to, so it is limited per visitor AND per recipient address,
// and whatever image is involved is watermarked here, on the server, before it goes anywhere.
const mailsByIp = new Map();
const mailsByRecipient = new Map();
function tooMany(map, key, max) {
  const now = Date.now();
  const recent = (map.get(key) || []).filter((t) => t > now - 3600000);
  if (recent.length >= max) { map.set(key, recent); return true; }
  map.set(key, [...recent, now]);
  return false;
}

app.post('/api/send-design', async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  const name = String(b.name || '').replace(/[\r\n<>]/g, ' ').trim().slice(0, 80);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  const isTest = b.test === true || process.env.TEST_MODE === '1';

  // Which design: an AI version by id (the server has the original), or the flat layout the browser drew
  let source = readOriginal(b.renderId);
  const fromRender = !!source;
  if (!source) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(typeof b.image === 'string' ? b.image : '');
    if (!m) return res.status(400).json({ error: 'There is no design to send yet.' });
    source = Buffer.from(m[1], 'base64');
  }

  const d = b.design && typeof b.design === 'object' ? b.design : {};
  const clip = (v, n) => String(v || '').replace(/[\r\n<>]/g, ' ').trim().slice(0, n);
  const texts = normalizeTexts({ top: d.topText, bottom: d.bottomText, center: d.centerText });
  const bg = normalizeBackground({ color: d.bgColor, colorName: d.bgColorName, texture: d.bgTexture });
  const summary = [
    ['Metal finish', finishLabel(d.finish)],
    ['Color', COLORS[normalizeColor(d.color)].label],
    ['Shape', SHAPES[normalizeShape(d.shape)].label],
    ['Background', [bg.name || bg.color, bg.texture !== 'smooth' ? bg.texture : ''].filter(Boolean).join(', ')],
    ['Top text', texts.top], ['Center text', texts.center], ['Bottom text', texts.bottom],
    ['Logo', clip(d.logoName, 120)],
  ];

  const lead = { email, name, newsletter: b.newsletter === true, test: isTest, ip: req.ip, renderId: fromRender ? b.renderId : null, design: Object.fromEntries(summary.filter(([, v]) => v)) };

  try {
    if (isTest) {
      saveLead({ ...lead, emailed: false });
      return res.json({ ok: true, sent: false, test: true });
    }
    if (!mailConfigured()) {
      // No SMTP yet: keep the lead and let the page fall back to a watermarked download
      saveLead({ ...lead, emailed: false });
      console.warn('[coin-builder] design requested by email but SMTP is not configured; falling back to download');
      return res.json({ ok: true, sent: false, fallback: 'download' });
    }
    if (tooMany(mailsByIp, req.ip, Number(process.env.MAIL_LIMIT_PER_HOUR || 6)) || tooMany(mailsByRecipient, email, 3)) {
      return res.status(429).json({ error: 'That is a lot of emails in a short time. Please try again in an hour.' });
    }
    const image = await watermark(source, { strength: 'download', size: 1600 }); // throws rather than send a clean image
    await sendDesignEmail({ to: email, name, image, summary, siteUrl: process.env.PUBLIC_URL || '' });
    const record = saveLead({ ...lead, emailed: true });
    notifyLead(record);
    console.log(`[coin-builder] design emailed to ${email}`);
    res.json({ ok: true, sent: true });
  } catch (e) {
    console.error('[coin-builder] send-design error:', e.message);
    res.status(502).json({ error: 'Sorry, we could not send the email just now. Please try again in a moment.' });
  }
});

// The picture inside a design email sent through Brevo (always a watermarked copy, under an unguessable id)
app.get('/mail-img/:id.jpg', (req, res) => {
  const img = readMailImage(req.params.id);
  if (!img) return res.status(404).end();
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=2592000' });
  res.send(img);
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
