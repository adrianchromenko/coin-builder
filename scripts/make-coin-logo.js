'use strict';
// Builds public/brand/logo-coin.webp: the company logo as it sits on the back of the turning gold coins (the loading
// coin and the waiting coin). It is the logo drawn larger, with a soft shadow under it and a lit edge above it so it
// reads as raised from the metal. Baked into the picture so the page has nothing to compute while the coin turns.
// Run `npm run coin-logo` after changing public/brand/logo.webp, then commit the result.

const path = require('path');
const sharp = require('sharp');

const BRAND = path.join(__dirname, '..', 'public', 'brand');
const WIDTH = 630; // twice the size the largest coin shows it at
const PAD = 26;    // room around the logo for the shadow

// The logo's outline as a layer of one colour: softened, moved, and let through at the given strength
async function silhouette(alpha, { color, blur, opacity, width, height }) {
  const mask = await sharp(alpha, { raw: { width, height, channels: 1 } }).blur(blur).linear(opacity, 0).toColourspace('b-w').raw().toBuffer();
  if (mask.length !== width * height) throw new Error('the outline came back with more than one channel');
  return sharp({ create: { width, height, channels: 3, background: color } }).joinChannel(mask, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

(async () => {
  // Enlarging and sharpening leaves a faint haze in the clear areas, which would show on the gold: anything that
  // faint is made fully clear
  const big = await sharp(path.join(BRAND, 'logo.webp')).resize({ width: WIDTH, kernel: 'lanczos3' }).sharpen({ sigma: 0.6 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = big.info;
  for (let i = 3; i < big.data.length; i += 4) if (big.data[i] < 40) big.data[i] = 0;
  const logo = await sharp(big.data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const alpha = await sharp(logo).extractChannel('alpha').raw().toBuffer();
  const shadow = await silhouette(alpha, { color: '#2A1903', blur: 6, opacity: 0.7, width, height });
  const lit = await silhouette(alpha, { color: '#FFF7CF', blur: 1.2, opacity: 0.85, width, height });
  const out = path.join(BRAND, 'logo-coin.webp');
  await sharp({ create: { width: width + PAD * 2, height: height + PAD * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: shadow, left: PAD, top: PAD + 8 },
      { input: lit, left: PAD, top: PAD - 3 },
      { input: logo, left: PAD, top: PAD },
    ])
    .webp({ quality: 92, alphaQuality: 100 })
    .toFile(out);
  const made = await sharp(out).metadata();
  console.log(`${path.relative(process.cwd(), out)}  ${made.width} x ${made.height}`);
})();
