'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const multer = require('multer');
const { getProvider } = require('./lib/providers');
const { FINISHES } = require('./lib/prompt');
const { countReferences } = require('./lib/references');
const { SIZES, hasPricing, estimate } = require('./lib/pricing');
const { saveOrder, updateOrder, notifyWebhook, createCheckout } = require('./lib/orders');
const { finishLabel } = require('./lib/prompt');

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
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '12mb' }));

app.get('/api/config', (_req, res) => {
  const provider = getProvider();
  res.json({
    provider: provider.name,
    finishes: Object.keys(FINISHES),
    references: countReferences(),
    sizes: SIZES,
    pricing: hasPricing(),
    payments: !!(process.env.STRIPE_SECRET_KEY && hasPricing()),
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
  const finish = FINISHES[b.finish] ? b.finish : 'gold';
  const name = String(b.name || '').trim().slice(0, 120);
  const email = String(b.email || '').trim().slice(0, 200);
  const phone = String(b.phone || '').trim().slice(0, 40);
  const notes = String(b.notes || '').trim().slice(0, 1000);

  if (!quantity || quantity < 1 || quantity > 100000) return res.status(400).json({ error: 'Please enter a valid quantity.' });
  if (!SIZES.includes(size)) return res.status(400).json({ error: 'Please choose a valid coin size.' });
  if (!name) return res.status(400).json({ error: 'Please tell us your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });

  try {
    const record = saveOrder({
      finish,
      finishLabel: finishLabel(finish).replace(/ plating.*$/, ''),
      size,
      quantity,
      name,
      email,
      phone,
      notes,
      estimate: estimate(size, quantity),
      image: typeof b.image === 'string' ? b.image : '',
      ip: req.ip,
    });
    console.log(`[coin-builder] order ${record.id}: ${quantity} x ${size}" ${finish} for ${email}`);

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

    const finish = FINISHES[req.body.finish] ? req.body.finish : 'gold';
    const notes = typeof req.body.notes === 'string' ? req.body.notes : '';

    try {
      const provider = getProvider();
      const started = Date.now();
      const result = await provider.generate({
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        finish,
        notes,
      });
      console.log(`[coin-builder] ${provider.name} generated coin (${finish}) in ${Date.now() - started}ms`);
      res.json({
        provider: provider.name,
        finish,
        image: `data:${result.mimetype};base64,${result.base64}`,
      });
    } catch (e) {
      console.error('[coin-builder] generation error:', e.message);
      res.status(502).json({ error: 'Sorry, I could not generate the coin right now. Please try again.' });
    }
  });
});

app.get('/healthz', (_req, res) => res.send('ok'));

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
