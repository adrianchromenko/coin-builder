'use strict';

/**
 * "Or paste a link": the customer gives the address of their website, or of a picture on it, instead of uploading
 * a file. An image address is fetched as it is. A web page is read for its logo: the first <img> that calls
 * itself a logo, then the site's touch icon, its share image and its favicon, whichever fetches as a picture.
 * Whatever comes back is turned into a PNG no larger than the builder needs.
 *
 * This fetches addresses a stranger typed, so it only ever talks to public hosts over http(s), follows a few
 * redirects at most (each hop checked again), gives up after a short wait and reads only so many bytes.
 */

const dns = require('dns').promises;
const net = require('net');
const sharp = require('sharp');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_HOPS = 4;
const TIMEOUT_MS = 10000;
const MAX_SIDE = 1200;
const UA = 'Mozilla/5.0 (compatible; CoinBuilder/1.0; +https://www.coinsforanything.com)';

class FetchError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Loopback, link-local, private and otherwise non-public ranges: never fetched, whatever name points there
function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return privateAddress(mapped[1]);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6);
}

async function checkHost(url) {
  if (!/^https?:$/.test(url.protocol)) throw new FetchError('The link has to start with http:// or https://.');
  if (url.username || url.password) throw new FetchError('That link cannot be used.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local')) throw new FetchError('That link cannot be used.');
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new FetchError('We could not find that website. Please check the link.');
  if (addresses.some((a) => privateAddress(a.address))) throw new FetchError('That link cannot be used.');
}

// Reads a response body up to the limit
async function readBody(res) {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new FetchError('That file is too large. Please keep it under 10 MB.');
  const chunks = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { reader.cancel().catch(() => {}); throw new FetchError('That file is too large. Please keep it under 10 MB.'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

// GET with redirects followed by hand, so every hop goes through the same checks
async function get(address, accept) {
  let url = new URL(address);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    await checkHost(url);
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA, Accept: accept } });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const to = res.headers.get('location');
      if (!to) throw new FetchError('That link does not lead anywhere.');
      url = new URL(to, url);
      continue;
    }
    if (!res.ok) throw new FetchError(`That link answered with an error (${res.status}).`);
    return { res, url };
  }
  throw new FetchError('That link redirects too many times.');
}

const imageType = (res) => (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();

// An image buffer as a PNG data URL, sized for the builder. Anything sharp cannot read (an .ico, a broken file) is refused.
async function toPng(buffer) {
  const png = await sharp(buffer, { limitInputPixels: 40e6 }).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

// A page's pictures that could be its logo, best guess first
function logoCandidates(html, base) {
  const found = [];
  const add = (src) => { if (src) { try { found.push(new URL(src.trim(), base).href); } catch (_) {} } };
  const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? (m[2] ?? m[3] ?? m[4]) : ''; };
  const tags = (name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
  for (const img of tags('img')) {
    const src = attr(img, 'src') || attr(img, 'data-src') || (attr(img, 'srcset') || '').split(',')[0].trim().split(/\s+/)[0];
    if (/logo/i.test(src + ' ' + attr(img, 'alt') + ' ' + attr(img, 'class') + ' ' + attr(img, 'id'))) add(src);
  }
  const links = tags('link');
  const rel = (want) => links.filter((l) => new RegExp(`(^|\\s)${want}(\\s|$)`, 'i').test(attr(l, 'rel')));
  for (const l of rel('apple-touch-icon')) add(attr(l, 'href'));
  for (const m of tags('meta')) if (/^(og:image|twitter:image)(:url)?$/i.test(attr(m, 'property') || attr(m, 'name'))) add(attr(m, 'content'));
  for (const l of rel('icon')) add(attr(l, 'href'));
  return [...new Set(found)].slice(0, 8);
}

/**
 * Fetches the picture at the address, or the logo of the page there.
 * Returns { image (PNG data URL), name, fromPage }.
 */
async function fetchImage(address) {
  let url;
  try { url = new URL(/^[a-z]+:\/\//i.test(address) ? address : `https://${address}`); } catch (_) { throw new FetchError('Please paste a full web address.'); }
  const { res, url: final } = await get(url.href, 'image/*,text/html;q=0.9,*/*;q=0.5');
  const type = imageType(res);
  const name = (u) => decodeURIComponent((u.pathname.split('/').filter(Boolean).pop() || u.hostname)).slice(0, 80);
  if (type.startsWith('image/')) {
    return { image: await toPng(await readBody(res)).catch(() => { throw new FetchError('We could not read that picture. Please try a PNG, JPG, WEBP or SVG.'); }), name: name(final), fromPage: false };
  }
  if (!/^(text\/html|application\/xhtml\+xml)$/.test(type)) throw new FetchError('That link is not a picture or a web page.');
  const html = (await readBody(res)).toString('utf8').slice(0, 1.5e6);
  const candidates = logoCandidates(html, final.href);
  for (const candidate of candidates) {
    try {
      const pick = await get(candidate, 'image/*');
      if (!imageType(pick.res).startsWith('image/') && !/\.(png|jpe?g|webp|svg|gif|avif)(\?|$)/i.test(candidate)) continue;
      return { image: await toPng(await readBody(pick.res)), name: name(pick.url), fromPage: true };
    } catch (_) { /* on to the next one */ }
  }
  throw new FetchError('We could not find a logo on that page. Try a link to the picture itself, or upload the file.', 404);
}

module.exports = { fetchImage, FetchError, privateAddress, logoCandidates };
