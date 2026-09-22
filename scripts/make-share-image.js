'use strict';
// Builds the pictures used for link previews and browser icons:
//   public/share.jpg            1200 x 630 card shown when the builder's link is shared (Facebook, LinkedIn, X, iMessage, Slack, Teams...)
//   public/favicon.ico, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png
// Run `npm run share-image` after changing the logo or the copy below, then commit the results.
// Fonts are fetched from Google Fonts into the OS temp folder (the page uses the same families).

const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const LOGO = path.join(PUBLIC, 'brand', 'logo.webp');
const COIN_PHOTO = path.join(ROOT, 'references', 'coins', 'display_aerial-port-dover-front.png');
const FONT_DIR = path.join(os.tmpdir(), 'coin-builder-fonts');

const DARK = '#1A1A1A';
const ORANGE = '#F58220';
const W = 1200;
const H = 630;

// Google Fonts hands out plain TTF files when the request comes without a browser user agent
async function font(family, weight) {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  const file = path.join(FONT_DIR, `${family.replace(/\s+/g, '')}-${weight}.ttf`);
  if (fs.existsSync(file)) return file;
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`, { headers: { 'User-Agent': 'curl/8' } })).text();
  const m = /url\((https:[^)]+\.ttf)\)/.exec(css);
  if (!m) throw new Error(`No TTF url for ${family} ${weight}`);
  fs.writeFileSync(file, Buffer.from(await (await fetch(m[1])).arrayBuffer()));
  return file;
}

async function text(markup, { family, fontfile, width, dpi = 72 }) {
  return sharp({ text: { text: markup, font: family, fontfile, width, dpi, rgba: true, wrap: 'word' } }).png().toBuffer();
}

async function shareCard() {
  const oswald = await font('Oswald', 700);
  const openSans = await font('Open Sans', 400);
  const openSansBold = await font('Open Sans', 700);

  // Coin photo on the right, fading into the dark left panel
  const photoSize = H;
  const photo = await sharp(COIN_PHOTO).resize(photoSize, photoSize, { fit: 'cover' }).toBuffer();
  const fadeX = W - photoSize;
  const fade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${DARK}" stop-opacity="1"/><stop offset="0.42" stop-color="${DARK}" stop-opacity="0"/></linearGradient></defs>
    <rect x="${fadeX}" y="0" width="${photoSize}" height="${H}" fill="url(#g)"/>
    <rect x="0" y="${H - 12}" width="${W}" height="12" fill="${ORANGE}"/>
  </svg>`);

  const logo = await sharp(LOGO).resize({ width: 330 }).png().toBuffer();
  // px sizes are in points at 72 dpi
  const headline = await text(`<span foreground="#FFFFFF" size="62pt" letter_spacing="512" line_height="0.95">DESIGN YOUR</span>\n<span foreground="${ORANGE}" size="62pt" letter_spacing="512" line_height="0.95">CUSTOM COIN</span>`, { family: 'Oswald', fontfile: oswald, width: 640 });
  const sub = await text(`<span foreground="#E8E4DE" size="21pt">Upload your logo, add your text and see your challenge coin in minutes. Free AI preview, no obligation.</span>`, { family: 'Open Sans', fontfile: openSans, width: 560 });
  const tag = await text(`<span foreground="#FFFFFF" size="15pt" weight="bold">100% VETERAN OWNED &amp; OPERATED   ·   20 MILLION COINS MINTED   ·   coinsforanything.com</span>`, { family: 'Open Sans', fontfile: openSansBold, width: 1100 });

  await sharp({ create: { width: W, height: H, channels: 3, background: DARK } })
    .composite([
      { input: photo, left: fadeX, top: 0 },
      { input: fade, left: 0, top: 0 },
      { input: logo, left: 64, top: 56 },
      { input: headline, left: 64, top: 200 },
      { input: sub, left: 66, top: 420 },
      { input: tag, left: 64, top: 560 },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(path.join(PUBLIC, 'share.jpg'));
  console.log('wrote public/share.jpg');
}

// Browser tab / home screen icon: an orange coin with a dark rim, same mark the page used inline before
function iconSvg(size) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">
    <circle cx="50" cy="50" r="50" fill="${DARK}"/>
    <circle cx="50" cy="50" r="42" fill="${ORANGE}"/>
    <circle cx="50" cy="50" r="31" fill="none" stroke="${DARK}" stroke-width="5"/>
    <text x="50" y="63" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="38" fill="${DARK}">C</text>
  </svg>`);
}

// ICO container holding PNG images (every current browser and Windows since Vista read these)
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e); offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

async function icons() {
  const png = (size) => sharp(iconSvg(size), { density: 300 }).resize(size, size).png().toBuffer();
  const out = { 'favicon-32.png': 32, 'apple-touch-icon.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 };
  for (const [name, size] of Object.entries(out)) fs.writeFileSync(path.join(PUBLIC, name), await png(size));
  fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), ico([{ size: 16, buf: await png(16) }, { size: 32, buf: await png(32) }, { size: 48, buf: await png(48) }]));
  console.log('wrote', Object.keys(out).concat('favicon.ico').join(', '));
}

(async () => {
  await shareCard();
  await icons();
})().catch((e) => { console.error(e); process.exit(1); });
