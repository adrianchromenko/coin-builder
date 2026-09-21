'use strict';

/**
 * Watermarks coin renders. The rule the whole app follows: a clean render never leaves the server.
 * The browser gets a small, lightly marked preview to show on screen and, on request, a full-size heavily
 * marked download. The clean original stays in ./renders for the order and for staff.
 *
 * What makes the mark hard for "watermark remover" tools:
 *  - it covers the whole image, including the lettering and the logo, so there is nothing clean to copy from and
 *    painting it out means repainting the customer's wording (which ruins it);
 *  - two layers at different sizes and angles, so it is not one regular grid that can be detected and subtracted;
 *  - white letters with a dark edge, so it survives brightness / contrast tricks on both light metal and dark enamel;
 *  - the placement is derived from the image itself: every render is marked differently (no template to reuse),
 *    but the same render is always marked the same way (downloading twice and combining the copies gains nothing).
 *
 * The artwork is two PNG files, not text drawn at runtime, so it cannot silently come out blank on a server
 * that has no fonts installed. Everything here throws on failure: callers must never fall back to the clean image.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const TILE = fs.readFileSync(path.join(__dirname, 'watermark', 'tile.png'));
const FOOTER = fs.readFileSync(path.join(__dirname, 'watermark', 'footer.png'));

// Repeatable "random" numbers from the image's own bytes
function seeded(buffer) {
  const hash = crypto.createHash('sha256').update(buffer).digest();
  let i = 0;
  return (min, max) => min + (hash[i++ % hash.length] / 255) * (max - min);
}

// One full-size transparent layer of the tile, scaled, turned, faded and shifted
async function layer({ width, height, scale, angle, opacity, shiftX, shiftY }) {
  const meta = await sharp(TILE).metadata();
  const tileW = Math.max(60, Math.round(meta.width * scale));
  const turned = await sharp(TILE).resize({ width: tileW }).rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = turned.data;
  for (let p = 3; p < px.length; p += 4) px[p] = Math.round(px[p] * opacity);
  const tile = await sharp(px, { raw: { width: turned.info.width, height: turned.info.height, channels: 4 } }).png().toBuffer();

  // Tile a canvas one tile larger than needed, then cut the window out at an offset
  const sheet = await sharp({ create: { width: width + turned.info.width, height: height + turned.info.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: tile, tile: true }]).png().toBuffer();
  return sharp(sheet).extract({ left: Math.floor(shiftX * turned.info.width), top: Math.floor(shiftY * turned.info.height), width, height }).png().toBuffer();
}

/**
 * strength 'preview' : light mark for the on-screen image
 * strength 'download': strong mark plus a footer band
 * size: longest edge of the result in pixels (the image is never enlarged)
 */
async function watermark(clean, { strength = 'download', size = null } = {}) {
  const rand = seeded(clean);
  let base = sharp(clean).rotate();
  if (size) base = base.resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true });
  const resized = await base.png().toBuffer();
  const { width, height } = await sharp(resized).metadata();

  const heavy = strength === 'download';
  const unit = width / 1024; // keeps the mark the same relative size at any resolution
  const layers = await Promise.all([
    layer({ width, height, scale: unit * rand(0.92, 1.12), angle: rand(-7, 7), opacity: heavy ? 0.3 : 0.17, shiftX: rand(0, 1), shiftY: rand(0, 1) }),
    layer({ width, height, scale: unit * rand(0.52, 0.64), angle: rand(-24, -12), opacity: heavy ? 0.17 : 0.09, shiftX: rand(0, 1), shiftY: rand(0, 1) }),
  ]);
  const overlays = layers.map((input) => ({ input, left: 0, top: 0 }));
  if (heavy) {
    const footer = await sharp(FOOTER).resize({ width }).png().toBuffer();
    const fh = (await sharp(footer).metadata()).height;
    overlays.push({ input: footer, left: 0, top: height - fh });
  }

  const out = await sharp(resized).composite(overlays).png({ compressionLevel: 9 }).toBuffer();
  // Belt and braces: if compositing changed nothing, something is wrong. Do not hand out a clean image.
  if (out.equals(resized)) throw new Error('watermark was not applied');
  return out;
}

// ---------- clean originals ----------
const RENDERS_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'renders');
const ID_RE = /^[0-9a-f]{32}$/;
const KEEP_DAYS = Math.max(1, Number(process.env.RENDER_KEEP_DAYS || 14));

function saveOriginal(clean) {
  fs.mkdirSync(RENDERS_DIR, { recursive: true });
  const id = crypto.randomBytes(16).toString('hex'); // unguessable: the id is the only key to the download
  fs.writeFileSync(path.join(RENDERS_DIR, `${id}.png`), clean);
  sweep();
  return id;
}

function readOriginal(id) {
  if (!ID_RE.test(String(id || ''))) return null;
  const file = path.join(RENDERS_DIR, `${id}.png`);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

// Renders nobody ordered are deleted after RENDER_KEEP_DAYS
function sweep() {
  try {
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    for (const f of fs.readdirSync(RENDERS_DIR)) {
      const file = path.join(RENDERS_DIR, f);
      if (f.endsWith('.png') && fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    }
  } catch (_) { /* housekeeping only */ }
}

module.exports = { watermark, saveOriginal, readOriginal };
