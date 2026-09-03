'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const multer = require('multer');
const { getProvider } = require('./lib/providers');
const { FINISHES } = require('./lib/prompt');

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

app.get('/api/config', (_req, res) => {
  const provider = getProvider();
  res.json({ provider: provider.name, finishes: Object.keys(FINISHES) });
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

app.listen(PORT, () => {
  console.log(`Coin Builder running on http://localhost:${PORT} (provider: ${getProvider().name})`);
});
