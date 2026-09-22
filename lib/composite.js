'use strict';

/**
 * Puts the front and back renders of a coin side by side in one photo, front on the left.
 * Each side is rendered on its own (its own prompt, proofreading and retry, at full resolution), which keeps the
 * lettering as accurate as a one-sided render; this only assembles the finished product shot.
 * Accepts PNG or SVG buffers (the demo provider makes SVGs) and always returns a PNG.
 */

const sharp = require('sharp');

const SIDE = 1024; // each coin is normalised to this square
const GAP = 48;    // dark strip between the two coins
const BG = { r: 28, g: 29, b: 33, alpha: 1 }; // the "plain dark charcoal background" the renders are asked for

async function sideBySide(front, back) {
  const [f, b] = await Promise.all([front, back].map((buf) => sharp(buf).resize(SIDE, SIDE, { fit: 'cover' }).png().toBuffer()));
  return sharp({ create: { width: SIDE * 2 + GAP, height: SIDE, channels: 4, background: BG } })
    .composite([{ input: f, left: 0, top: 0 }, { input: b, left: SIDE + GAP, top: 0 }])
    .png()
    .toBuffer();
}

module.exports = { sideBySide };
