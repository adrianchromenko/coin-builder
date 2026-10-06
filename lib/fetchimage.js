'use strict';

/**
 * "Or paste a link": the customer gives the address of their website, or of a picture on it, instead of uploading
 * a file. An image address is fetched as it is. A web page is read for its logo: every picture that could be it is
 * scored on where it sits (the header, the link back to the home page, a box that calls itself the logo), on what it
 * calls itself and on what the page's own data names as the logo; the likeliest few are fetched and looked at, and
 * the best one that really is a usable picture wins. The site's icons are the fallback. A page that offers nothing
 * better than a photo is answered with "no logo found" rather than a wrong picture.
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
const PICK_TIMEOUT_MS = 8000;
const TRIES = 6; // how many of a page's likeliest pictures are fetched and compared
// Many sites turn away anything that does not look like a browser
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

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
async function get(address, accept, timeout = TIMEOUT_MS) {
  let url = new URL(address);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    await checkHost(url);
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' } });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const to = res.headers.get('location');
      if (!to) throw new FetchError('That link does not lead anywhere.');
      url = new URL(to, url);
      continue;
    }
    if ([401, 403, 429, 503].includes(res.status)) throw new FetchError('That website would not let us read it. Please upload the logo file, or paste a link to the picture itself.');
    if (!res.ok) throw new FetchError(`That link answered with an error (${res.status}).`);
    return { res, url };
  }
  throw new FetchError('That link redirects too many times.');
}

const imageType = (res) => (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();

// An image buffer as a PNG, sized for the builder. Anything sharp cannot read (an .ico, a broken file) is refused.
// Returns { png, format } where format is what the file was (svg, png, jpeg...).
async function toPng(buffer) {
  const meta = await sharp(buffer, { limitInputPixels: 40e6 }).metadata();
  // An SVG is drawn at the size it declares, often a few dozen pixels: draw it large enough to work from
  const density = meta.format === 'svg' ? Math.min(2400, Math.max(72, Math.round(72 * 1000 / Math.max(meta.width || 1, meta.height || 1)))) : undefined;
  const png = await sharp(buffer, { limitInputPixels: 40e6, ...(density ? { density } : {}) }).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  return { png, format: meta.format };
}
const dataUrl = (png) => `data:image/png;base64,${png.toString('base64')}`;

// What a picture is like, from a thumbnail: how much of it is drawn on (opaque), how much of that is near white
// (light), and whether it is one flat colour (flat)
async function look(png) {
  const meta = await sharp(png).metadata();
  const { data } = await sharp(png).resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0, light = 0, min = 255, max = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 100) continue;
    opaque++;
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum > 205) light++;
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }
  const n = data.length / 4;
  return { width: meta.width, height: meta.height, opaque: opaque / n, light: opaque ? light / opaque : 0, flat: opaque / n > 0.97 && max - min < 12 };
}

// A white logo made for a dark header shows as nothing on the builder's white card: the same shape, in near black
async function darken(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = 17;
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

// ---------- reading a page for its logo ----------
const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? (m[2] ?? m[3] ?? m[4]) : ''; };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const initials = (s) => String(s || '').split(/[^a-z0-9]+/i).filter((w) => w && !/^(of|the|and|for|in|a)$/i.test(w)).map((w) => w[0]).join('').toLowerCase();
const bareHost = (h) => h.replace(/^www\./i, '').toLowerCase();
// "www.kingarthurbaking.com" -> "kingarthurbaking", "foo.co.uk" -> "foo"
function siteName(host) {
  const parts = bareHost(host).split('.');
  if (parts.length > 2 && parts[parts.length - 1].length === 2 && /^(co|com|org|net|gov|ac|edu|mil)$/.test(parts[parts.length - 2])) parts.pop();
  parts.pop();
  return norm(parts.pop());
}

// Words that say what a picture or the box around it is
const LOGO = /logo(?!s|-?(grid|wall|cloud|carousel|slider|strip|list|garden|bar))|(?<![\w-])brand(?![\w-])|(navbar|site|header|nav|app|top)-?brand(?![a-z])|site-title|site-identity|site-branding|wordmark/i;
const HEADER = /(?<![a-z])(header|masthead|navbar|topbar|top-bar|site-nav|main-nav)(?![a-z])/i;
// Somebody else's logo, or not a logo at all: partners, payment marks, social icons, slideshows. (Not "badge": a
// police or fire department's badge is its logo.)
const OTHERS = /partner|sponsor|payment|mastercard|paypal|accredit|affiliat|carousel|slider|swiper|marquee|testimonial|facebook|instagram|twitter|linkedin|youtube|tiktok|pinterest|app-?store|google-?play|trustpilot|gravatar|avatar|b-?corp|as-seen|logos(?![a-z])|logo-?(grid|wall|cloud|strip|list|garden|bar)|(?<![a-z])(clients?|flags?|bbb|visa|amex|awards?|social|slick)(?![a-z])/i;
const PLACEHOLDER = /^data:|placeholder|blank\.|spacer|pixel\.|1x1|lazy|loading\.|transparent\./i;
const WHITE = /(?<![a-z])(white|light|inverse|inverted|reversed?|negative|wht|knockout)(?![a-z])/i;
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr']);

/**
 * A page's pictures that could be its logo, likeliest first: [{ url | svg, score, why }].
 * url is a picture to fetch; svg is a drawing written into the page itself.
 */
function logoCandidates(html, base) {
  const page = new URL(base);
  const site = siteName(page.hostname);
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const metaOf = (key) => { for (const m of metaTags) if ((attr(m, 'property') || attr(m, 'name') || attr(m, 'itemprop')).toLowerCase() === key) return attr(m, 'content'); return ''; };
  const brand = norm(metaOf('og:site_name') || metaOf('application-name'));
  // does this text name the site? ("VFW", "Veterans of Foreign Wars", "King Arthur Baking Company logo")
  const names = (text) => {
    const t = norm(text);
    if (!t || String(text).trim().split(/\s+/).length > 6) return false; // a name, not a sentence that mentions the site
    // a short name has to stand as a word: "ups" is in "groups" and "pickups"
    const has = site.length >= 5 ? t.includes(site) : String(text).toLowerCase().split(/[^a-z0-9]+/).includes(site);
    return (site.length >= 3 && (has || initials(text) === site)) || (t.length >= 4 && site.includes(t))
      || (brand.length >= 3 && (t.includes(brand) || (t.length >= 4 && brand.includes(t))));
  };
  // addresses in a page are written with &amp; for &
  const resolve = (src) => { try { const u = new URL(String(src).trim().replace(/&(amp|#0*38|#x0*26);/gi, '&'), base); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch (_) { return ''; } };
  const fileOf = (url) => { try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '').toLowerCase(); } catch (_) { return ''; } };

  const found = new Map();
  // kind: where on the page it was found (data, img, svg, icon, share)
  const add = (key, c) => {
    const had = found.get(key);
    if (!had) { found.set(key, { ...c, seen: 1 }); return; }
    had.seen++;
    const agree = had.kind !== c.kind && !had.agreed; // two different parts of the page naming the same picture counts for more, once
    if (c.score > had.score) Object.assign(had, c);
    if (agree) { had.score += 2; had.agreed = had.sure = true; }
  };
  const addUrl = (src, score, why, kind) => { const url = resolve(src); if (url) add(url, { url, score, why, kind }); };

  // What the page's own data calls its logo
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) { for (const n of node) walk(n, depth + 1); return; }
    const logo = Array.isArray(node.logo) ? node.logo[0] : node.logo;
    const src = typeof logo === 'string' ? logo : logo && typeof logo === 'object' ? (logo.url || logo.contentUrl) : '';
    if (typeof src === 'string' && src) {
      const org = /organization|business|corporation|website|ngo|store|restaurant|agency/i.test(String(node['@type']));
      addUrl(src, org ? 12 : 6, org ? 'the page data names it as the logo' : 'named as a logo in the page data', 'data');
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1]), 0); } catch (_) { /* not valid JSON: nothing to read */ }
  }
  for (const key of ['og:logo', 'logo']) { const v = metaOf(key); if (v) addUrl(v, 10, 'the page names it as the logo', 'data'); }

  // A link back to the home page: the usual wrapper of a site's logo
  const isHome = (href) => {
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href.trim())) return false;
    let u;
    try { u = new URL(href.trim(), base); } catch (_) { return false; }
    if (bareHost(u.hostname) !== bareHost(page.hostname)) return false;
    return u.pathname === page.pathname || /^\/?(([a-z]{2}([-_][a-z]{2})?)\/?)?((index|home|default)(\.\w+)?\/?)?$/i.test(u.pathname);
  };
  const srcOf = (tag) => {
    const src = attr(tag, 'src');
    const lazy = attr(tag, 'data-src') || attr(tag, 'data-lazy-src') || attr(tag, 'data-original');
    const set = (attr(tag, 'srcset') || attr(tag, 'data-srcset')).split(',').map((p) => p.trim().split(/\s+/)).filter((p) => p[0]);
    const largest = set.sort((a, b) => parseFloat(b[1] || '1') - parseFloat(a[1] || '1'))[0];
    return src && !PLACEHOLDER.test(src) ? src : lazy || (largest && largest[0]) || '';
  };

  // The page, tag by tag, keeping track of what each picture sits inside
  const stack = [];
  const rows = new Map(); // the pictures that share a box (two levels up), to tell a logo on its own from a row of them
  let boxes = 0;
  const TAG = /<!--[\s\S]*?-->|<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let rank = 0; // how many likely pictures came before this one: a site's own logo is near the top of the page
  let m;
  while ((m = TAG.exec(html))) {
    if (!m[3]) continue;
    const name = m[3].toLowerCase();
    if (m[2]) { const at = stack.map((e) => e.name).lastIndexOf(name); if (at !== -1) stack.length = at; continue; }
    const tag = ` ${m[4] || ''} `;
    const own = `${attr(tag, 'class')} ${attr(tag, 'id')}`;
    const inside = {
      home: stack.some((e) => e.home), logo: stack.some((e) => e.logo), others: stack.some((e) => e.others),
      footer: stack.some((e) => e.footer), header: stack.some((e) => e.header),
    };
    // where it sits: the same sums for a picture and for a drawing
    const placed = (why) => {
      let score = 0;
      if (inside.home) { score += 5; why.push('links to the home page'); }
      if (inside.logo) { score += 4; why.push('in a box marked logo'); }
      if (inside.header && !inside.footer) { score += 3; why.push('in the header'); }
      if (inside.footer) { score -= 2; why.push('in the footer'); }
      if (inside.others) { score -= 6; why.push('among other logos'); }
      return score;
    };

    if (name === 'img') {
      const src = srcOf(tag);
      const url = src && resolve(src);
      if (!url) continue;
      const file = fileOf(url), alt = `${attr(tag, 'alt')} ${attr(tag, 'title')}`;
      const why = [];
      let score = placed(why);
      if (LOGO.test(own)) { score += 4; why.push('marked as the logo'); }
      if (/logo/.test(file)) { score += 3; why.push('file named logo'); }
      if (/logo/i.test(alt)) { score += 2; why.push('described as a logo'); }
      if (names(alt)) { score += 3; why.push('described with the site name'); }
      if (site.length >= 4 && norm(file).includes(site)) { score += 2; why.push('file named after the site'); }
      if (attr(tag, 'itemprop').toLowerCase() === 'logo') { score += 6; why.push('the page names it as the logo'); }
      if (OTHERS.test(`${own} ${alt} ${file}`)) { score -= 6; why.push('looks like someone else\'s mark'); }
      if (WHITE.test(file)) score -= 1.5; // the version for dark backgrounds: the plain one is better when the page has both
      if (/\.svg$/.test(file)) score += 1; else if (/\.jpe?g$/.test(file)) score -= 0.5; else if (/\.gif$/.test(file)) score -= 1;
      const w = Number(attr(tag, 'width')), h = Number(attr(tag, 'height'));
      if (w && h && Math.max(w, h) < 32 && !/\.svg$/.test(file)) score -= 5; // shown tiny: an icon (a vector is as good at any size)
      const row = (stack[stack.length - 2] || stack[stack.length - 1] || {}).id || 0;
      if (!rows.has(row)) rows.set(row, new Set());
      rows.get(row).add(url);
      // does anything tie it to this site, rather than to a logo the site happens to show?
      const sure = inside.home || names(alt) || (site.length >= 4 && norm(file).includes(site)) || attr(tag, 'itemprop').toLowerCase() === 'logo';
      if (score >= 3) { score += Math.max(0, 2 - 0.25 * rank++); add(url, { url, score, why: why.join(', '), kind: 'img', row, sure }); }
      continue;
    }

    if (name === 'svg' && !/\/\s*$/.test(m[4] || '')) {
      // A logo drawn into the page itself. Taken whole when it stands on its own and is the home link's drawing or
      // says it is the logo: a header is full of small drawings (arrows, a magnifying glass) that are neither
      const close = /<\/svg\s*>/gi;
      close.lastIndex = TAG.lastIndex;
      const end = close.exec(html);
      if (!end) continue;
      const markup = html.slice(m.index, close.lastIndex);
      TAG.lastIndex = close.lastIndex;
      const label = `${attr(tag, 'aria-label')} ${(/<title[^>]*>([^<]*)</i.exec(markup) || [])[1] || ''}`;
      const why = ['drawn into the page'];
      let score = placed(why) - 3; // its colours may come from the page's styles, which are not read
      if (LOGO.test(own)) { score += 4; why.push('marked as the logo'); }
      if (/logo/i.test(label) || names(label)) { score += 3; why.push('described as the logo'); }
      if (OTHERS.test(`${own} ${label}`)) score -= 6;
      if (markup.length < 500) score -= 3; // a few strokes: an icon
      const meant = inside.home || LOGO.test(own) || /logo/i.test(label) || names(label);
      if (meant && score >= 3 && markup.length < 200000 && !/<(use|image|foreignObject)\b/i.test(markup)) {
        score += Math.max(0, 2 - 0.25 * rank++);
        add(markup, { svg: markup, score, why: why.join(', '), kind: 'svg' });
      }
      continue;
    }

    if (VOID.has(name) || /\/\s*$/.test(m[4] || '')) continue;
    if (name === 'html' || name === 'body') continue; // their classes describe the whole page, not a place on it
    stack.push({
      name, id: ++boxes,
      header: name === 'header' || name === 'nav' || HEADER.test(own) || attr(tag, 'role').toLowerCase() === 'banner',
      footer: name === 'footer' || /footer/i.test(own),
      logo: LOGO.test(own),
      others: OTHERS.test(own),
      home: name === 'a' && isHome(attr(tag, 'href')),
    });
  }

  // The site's icons and share image: what is left when the page shows no logo of its own
  const links = html.match(/<link\b[^>]*>/gi) || [];
  const rel = (want) => links.filter((l) => new RegExp(`(^|\\s)${want}(\\s|$)`, 'i').test(attr(l, 'rel')));
  const side = (l) => parseInt(attr(l, 'sizes'), 10) || 0;
  for (const l of rel('apple-touch-icon(-precomposed)?')) addUrl(attr(l, 'href'), side(l) >= 150 ? 5 : 4, 'the site\'s touch icon', 'icon');
  for (const l of rel('icon')) { const href = attr(l, 'href'); addUrl(href, /logo/i.test(href) ? 5 : /\.svg(\?|$)/i.test(href) || side(l) >= 96 ? 3 : 1, 'the site\'s icon', 'icon'); }
  // most sites keep a touch icon at the root whether or not the page says so
  if (!rel('apple-touch-icon(-precomposed)?').length) addUrl('/apple-touch-icon.png', 3.5, 'the site\'s touch icon', 'icon');
  for (const key of ['og:image', 'og:image:url', 'twitter:image']) {
    const v = metaOf(key);
    if (v) addUrl(v, /logo/.test(fileOf(resolve(v))) ? 6 : 1.5, 'the picture the site shares', 'share');
  }
  // A picture that only calls itself a logo, with nothing tying it to this site: one of a row is a customer's or a
  // partner's, and one on its own is only a maybe
  for (const c of found.values()) {
    if (c.kind !== 'img' || c.sure) continue;
    if (rows.get(c.row).size >= 3) { c.score -= 8; c.why += ', one of a row of logos'; } else c.score = Math.min(c.score, 6);
  }
  // a drawing the page repeats is one of its icons, not its logo
  return [...found.values()].filter((c) => !(c.svg && c.seen > 2)).sort((a, b) => b.score - a.score);
}

// A drawing lifted from a page, made to stand on its own: namespaced, sized, and with "the text colour" as near black
function standalone(svg) {
  let s = svg.replace(/currentColor/gi, '#111111');
  const open = /^<svg\b[^>]*>/i.exec(s)[0];
  let head = open;
  if (!/\sxmlns\s*=/.test(head)) head = head.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  const box = attr(head, 'viewBox').trim().split(/[\s,]+/).map(Number);
  if (box.length === 4 && box[2] > 0 && box[3] > 0) {
    // the page's styles set its size; on its own it takes the shape of its drawing area
    head = head.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/^<svg/i, `<svg width="${box[2]}" height="${box[3]}"`);
  }
  return Buffer.from(s.replace(open, head));
}

// Fetches one candidate and judges the picture itself. Returns the candidate with its PNG and final score, or null.
async function tryCandidate(c) {
  try {
    let buffer, from = null;
    if (c.svg) buffer = standalone(c.svg);
    else {
      const pick = await get(c.url, 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.9', PICK_TIMEOUT_MS);
      if (!imageType(pick.res).startsWith('image/') && !/\.(png|jpe?g|webp|svg|gif|avif)(\?|$)/i.test(c.url)) return null;
      buffer = await readBody(pick.res);
      from = pick.url;
    }
    let { png, format } = await toPng(buffer);
    const seen = await look(png);
    const long = Math.max(seen.width, seen.height), short = Math.min(seen.width, seen.height);
    // not a usable picture: a dot, a sliver, an empty or one-colour box
    if (long < 40 || long / short > 10 || seen.opaque < 0.005 || seen.flat) return null;
    let score = c.score;
    const why = [c.why];
    if (format === 'svg' || seen.opaque < 0.97) score += 1.5; // cut out of its background, as logos are
    if (long < 80) score -= 2;
    if (format === 'jpeg') {
      score -= 1;
      if (long >= 800 && long / short > 1.2 && long / short < 2.3) { score -= 3; why.push('shaped like a photo'); }
    }
    if (seen.opaque < 0.9 && seen.light > 0.97) { png = await darken(png); why.push('white, so drawn dark'); }
    return { ...c, png, from, score, why: why.filter(Boolean).join('; ') };
  } catch (_) { return null; }
}

/**
 * Fetches the picture at the address, or the logo of the page there.
 * Returns { image (PNG data URL), name, fromPage, source, why }.
 */
async function fetchImage(address) {
  let url;
  try { url = new URL(/^[a-z]+:\/\//i.test(address) ? address : `https://${address}`); } catch (_) { throw new FetchError('Please paste a full web address.'); }
  const { res, url: final } = await get(url.href, 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5');
  const type = imageType(res);
  const name = (u) => decodeURIComponent((u.pathname.split('/').filter(Boolean).pop() || u.hostname)).slice(0, 80);
  if (type.startsWith('image/')) {
    const { png } = await toPng(await readBody(res)).catch(() => { throw new FetchError('We could not read that picture. Please try a PNG, JPG, WEBP or SVG.'); });
    return { image: dataUrl(png), name: name(final), fromPage: false, source: final.href, why: 'a link to the picture itself' };
  }
  if (!/^(text\/html|application\/xhtml\+xml)$/.test(type)) throw new FetchError('That link is not a picture or a web page.');
  const html = (await readBody(res)).toString('utf8').slice(0, 1.5e6);
  const candidates = logoCandidates(html, final.href);
  // The likeliest few are fetched together and the best real picture wins; the next few only if none of those will do
  for (let i = 0; i < candidates.length && i < TRIES * 2; i += TRIES) {
    const tried = (await Promise.all(candidates.slice(i, i + TRIES).map(tryCandidate))).filter((c) => c && c.score >= 1);
    if (!tried.length) continue;
    const best = tried.sort((a, b) => b.score - a.score)[0];
    return { image: dataUrl(best.png), name: best.from ? name(best.from) : `${bareHost(final.hostname)} logo`, fromPage: true, source: best.from ? best.from.href : 'drawn into the page', why: best.why };
  }
  throw new FetchError('We could not find a logo on that page. Try a link to the picture itself, or upload the file.', 404);
}

module.exports = { fetchImage, FetchError, privateAddress, logoCandidates };
