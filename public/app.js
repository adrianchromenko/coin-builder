(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // Finish, color, shape and add-on choices match the quote form at coinsforanything.com/quote
  const FINISHES = [
    { key: 'antique-brass', label: 'Antique Brass', colors: ['#cdb26a', '#8c6d2c', '#3f2f12'] },
    { key: 'antique-copper', label: 'Antique Copper', colors: ['#c98f6b', '#8a4a26', '#3d1f10'] },
    { key: 'shiny-copper', label: 'Shiny Copper', colors: ['#f2b58c', '#b8622e', '#6e3416'] },
    { key: 'antique-gold', label: 'Antique Gold', colors: ['#d9c27a', '#9a7a2a', '#4a3810'] },
    { key: 'shiny-gold', label: 'Shiny Gold', colors: ['#f8e27a', '#c9971c', '#7a5510'] },
    { key: 'satin-gold', label: 'Satin Gold', colors: ['#ead79a', '#c4a550', '#8a6c28'] },
    { key: 'antique-silver', label: 'Antique Silver', colors: ['#d7d9dc', '#8f949a', '#44484d'] },
    { key: 'shiny-silver', label: 'Shiny Silver', colors: ['#f4f4f4', '#b9bcc2', '#6b6f75'] },
    { key: 'satin-silver', label: 'Satin Silver', colors: ['#e3e4e6', '#b4b7bb', '#7d8186'] },
    { key: 'shiny-nickel', label: 'Shiny Nickel', colors: ['#ecebe6', '#aeada6', '#62615b'] },
    { key: 'satin-nickel', label: 'Satin Nickel', colors: ['#d9d8d2', '#a6a59e', '#706f69'] },
    { key: 'black-nickel', label: 'Black Nickel', colors: ['#8a8f96', '#3f444b', '#15181c'] },
  ];
  const DEFAULT_FINISH = 'shiny-gold';
  const COLORS = { 'color-one': 'Unlimited color, one side', 'color-both': 'Unlimited color, both sides', none: 'No color' };
  const SHAPES = { round: 'Round', odd: 'Custom shape' };
  // Center background: enamel colors a mint would stock, and textures that are struck into the metal.
  // Color and texture combine: translucent enamel over a textured field, so the texture shows through.
  const BG_COLORS = [
    { name: 'Black', hex: '#111111' }, { name: 'Navy', hex: '#14284B' }, { name: 'Royal Blue', hex: '#1F4FA3' }, { name: 'Sky Blue', hex: '#4A90D9' },
    { name: 'Red', hex: '#B71C1C' }, { name: 'Maroon', hex: '#6D1220' }, { name: 'Forest Green', hex: '#1E5631' }, { name: 'Kelly Green', hex: '#2E8B3D' },
    { name: 'Yellow', hex: '#F2C200' }, { name: 'Orange', hex: '#E8730C' }, { name: 'Purple', hex: '#4B2A7B' }, { name: 'White', hex: '#F2F2EE' },
  ];
  const BG_TEXTURES = { smooth: 'Smooth', sandblast: 'Sandblast', sunburst: 'Sunburst', diamond: 'Diamond Cut' };
  const bgColorName = (hex) => { const c = BG_COLORS.find((x) => x.hex.toLowerCase() === String(hex).toLowerCase()); return c ? c.name : 'Custom color'; };
  const hasBackground = () => !!(design.bgColor || design.bgTexture !== 'smooth');
  const backgroundLabel = () => (!hasBackground() ? '' : design.bgColor && design.bgTexture !== 'smooth'
    ? `Translucent ${bgColorName(design.bgColor).toLowerCase()} over ${BG_TEXTURES[design.bgTexture].toLowerCase()}`
    : design.bgColor ? `${bgColorName(design.bgColor)} enamel background` : `${BG_TEXTURES[design.bgTexture]} background`);
  const COLOR_SHORT = { 'color-one': 'Color, one side', 'color-both': 'Color, both sides', none: 'No color' };
  // Add-ons with a `group` are the one-side / both-sides versions of the same thing (pick one or neither)
  const ADDONS = [
    { key: 'epoxy-one', label: 'Epoxy Dome, One Side', group: 'epoxy', option: 'One Side', price: '+35¢' },
    { key: 'epoxy-both', label: 'Epoxy Dome, Both Sides', group: 'epoxy', option: 'Both Sides', price: '+40¢' },
    { key: 'two-tone-one', label: '2-Tone Plating, One Side', group: 'two-tone', option: 'One Side', price: '+65¢' },
    { key: 'two-tone-both', label: '2-Tone Plating, Both Sides', group: 'two-tone', option: 'Both Sides', price: '+$1.30' },
    { key: 'bottle-opener', label: 'Bottle Opener', desc: 'A working opener cut into the coin' },
    { key: 'key-chain', label: 'Key Chain', desc: 'Loop and split ring at the top', price: '+75¢ each · $75 set-up' },
    { key: 'numbering', label: 'Numbering', desc: 'Every coin individually numbered', price: '+35¢ each' },
    { key: 'edge-text', label: 'Rolling Edge Text', desc: 'Your words engraved around the edge' },
  ];
  const ADDON_GROUPS = {
    epoxy: { label: 'Epoxy Dome', desc: 'A clear, glossy dome that protects the artwork' },
    'two-tone': { label: '2-Tone Plating', desc: 'Two metals on one coin for extra contrast' },
  };
  const SIZES = ['1.5', '1.75', '2', '2.5', '3'];
  const QUANTITIES = [50, 100, 250, 500, 1000];

  const finishOf = (key) => FINISHES.find((f) => f.key === key) || FINISHES.find((f) => f.key === DEFAULT_FINISH);
  const addonOf = (key) => ADDONS.find((a) => a.key === key);
  const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

  // ---------- state ----------
  const config = { pricing: false, payments: false, testMode: false, provider: '' };
  const newDesign = () => ({ logo: null, logoName: '', topText: '', bottomText: '', centerText: '', logoAspect: 1, finish: DEFAULT_FINISH, color: 'color-one', shape: 'round', bgColor: '', bgTexture: 'smooth', border: 'plain', logoSize: 82 });
  const design = newDesign();
  const order = {
    quantity: null, size: null, estimate: null, notes: '', addons: [],
    name: '', email: '', phone: '', company: '',
    billStreet: '', billCityStateZip: '', billCountry: 'United States',
    street: '', cityStateZip: '', country: 'United States',
  };
  // Every AI render is kept as a version: the picture, the proofreading result, and the design that produced it
  const MAX_VERSIONS = 8;
  const ai = { versions: [], current: null, nextNumber: 1, view: 'layout', busy: false };
  const currentVersion = () => ai.versions.find((v) => v.id === ai.current) || null;
  let busy = false;

  const configReady = fetch('/api/config').then((r) => r.json()).then((c) => {
    Object.assign(config, c);
    if (c.testMode) setTestMode(true, { persist: false });
    updateOrderButton();
  }).catch(() => {});

  // ---------- toast ----------
  let toastTimer = null;
  function toast(html, ms = 3200) {
    const t = $('toast');
    t.innerHTML = html;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ---------- test mode ----------
  // ?test=1 (sticks for this tab), the header switch, or TEST_MODE=1 on the server.
  // In test mode: no AI call (your layout is used as the coin), orders are saved as
  // TEST- orders, and payment goes through the in-page test checkout instead of Stripe.
  const testState = { on: false };
  const isTest = () => testState.on;
  const testToggle = $('test-toggle');
  function setTestMode(on, { persist = true } = {}) {
    testState.on = !!on;
    testToggle.setAttribute('aria-pressed', testState.on ? 'true' : 'false');
    testToggle.querySelector('.test-toggle-state').textContent = testState.on ? 'On' : 'Off';
    testToggle.hidden = !testState.on; // customers never see the switch; staff get it once /?test=1 turns test mode on
    $('review-test').hidden = !testState.on;
    if (persist) {
      try { on ? sessionStorage.setItem('cfaTestMode', '1') : sessionStorage.removeItem('cfaTestMode'); } catch (_) {}
    }
    updateOrderButton();
  }
  (function initTestMode() {
    const params = new URLSearchParams(window.location.search);
    let on = false;
    try { on = sessionStorage.getItem('cfaTestMode') === '1'; } catch (_) {}
    if (params.has('test')) {
      on = params.get('test') !== '0';
      params.delete('test');
      const qs = params.toString();
      history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
    }
    setTestMode(on);
  })();
  testToggle.addEventListener('click', () => {
    setTestMode(!isTest());
    toast(isTest()
      ? '<span class="test-tag">TEST</span> Test mode is on: no AI render, no real payment. Orders are saved as TEST orders.'
      : 'Test mode is off. Coins render for real and orders go to the Coins for Anything team.');
  });

  // ---------- coin SVG (the "drop it in place" preview) ----------
  // ---------- lettering layout ----------
  // Everything here works in the coin's own 1024 x 1024 coordinate space, centered on (512, 512).
  // Lettering is MEASURED with the real font, never estimated: a "W" is half again as wide as an "I",
  // so guessing from the character count is what used to push long wording off its path or into the inner ring.
  const FONT = "Georgia, 'Times New Roman', serif";
  const CAP = 0.69;      // height of the capitals as a fraction of the font size
  const TRACK = 0.06;    // normal letter-spacing, in em
  const SAFETY = 1.04;   // browsers differ a little in how they space bold serif type
  const measureCtx = document.createElement('canvas').getContext('2d');
  function textWidth(text, size, track = TRACK) {
    measureCtx.font = `bold ${size}px ${FONT}`;
    return (measureCtx.measureText(text).width + text.length * size * track) * SAFETY;
  }
  const deg = (rad) => (rad * 180) / Math.PI;

  // The two legends share one ring around the coin (radius 352 to 400).
  const RIM = { mid: 376, max: 54, min: 18, maxSpan: 210, gap: 22, shortSpan: 62, maxTrack: 0.3 };
  function rimLegend(text, size, outward) {
    // Letters stand on the baseline: growing outward for the top legend, inward for the bottom one,
    // so both read left to right. Either way the lettering is centered in the ring.
    const r = outward ? RIM.mid - (size * CAP) / 2 : RIM.mid + (size * CAP) / 2;
    return { text, size, r, track: TRACK, span: deg(textWidth(text, size) / r) };
  }
  function layoutRim(top, bottom) {
    const fits = (size) => {
      const t = top ? rimLegend(top, size, true) : null;
      const b = bottom ? rimLegend(bottom, size, false) : null;
      const total = (t ? t.span : 0) + (b ? b.span : 0);
      const room = t && b ? 360 - 2 * RIM.gap : RIM.maxSpan;
      return total <= room && (!t || t.span <= RIM.maxSpan) && (!b || b.span <= RIM.maxSpan) ? { t, b } : null;
    };
    // One size for both legends, as on a real coin: the largest that lets them share the ring
    let size = RIM.max, found = null;
    for (; size >= RIM.min; size -= 0.5) { found = fits(size); if (found) break; }
    if (!found) found = fits(RIM.min) || { t: top ? rimLegend(top, RIM.min, true) : null, b: bottom ? rimLegend(bottom, RIM.min, false) : null };
    let { t, b } = found;

    // A short legend next to a long one may be a little larger, as long as they still look like a pair
    if (t && b) {
      const grow = (short, long, outward) => {
        let best = short;
        for (let sz = short.size + 0.5; sz <= Math.min(RIM.max, long.size * 1.2); sz += 0.5) {
          const c = rimLegend(short.text, sz, outward);
          if (c.span + long.span > 360 - 2 * RIM.gap || c.span > long.span) break;
          best = c;
        }
        return best;
      };
      if (t.span < b.span) t = grow(t, b, true); else if (b.span < t.span) b = grow(b, t, false);
    }
    // Very short wording ("EST. 1775") is opened up with wider letter-spacing so it holds its place on the ring
    for (const l of [t, b]) {
      if (!l || l.text.length < 2 || l.span >= RIM.shortSpan) continue;
      const extraPx = ((RIM.shortSpan - l.span) * Math.PI / 180) * l.r;
      l.track = Math.min(RIM.maxTrack, TRACK + extraPx / (l.text.length * l.size * SAFETY));
      l.span = deg(textWidth(l.text, l.size, l.track) / l.r);
    }
    // Separator dots sit in the middle of the two gaps between the legends
    const dots = t && b ? [1, -1].map((side) => {
      const a = (side * ((t.span / 2) + (180 - b.span / 2)) / 2) * Math.PI / 180;
      return { x: 512 + RIM.mid * Math.sin(a), y: 512 - RIM.mid * Math.cos(a) };
    }) : [];
    return { top: t, bottom: b, dots };
  }

  // Best place to break wording into two balanced lines, or null if it is a single word
  function splitBalanced(text) {
    const words = text.split(' ');
    if (words.length < 2) return null;
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
      const widest = Math.max(textWidth(lines[0], 40), textWidth(lines[1], 40));
      if (!best || widest < best.widest) best = { lines, widest, firstLineWords: i };
    }
    return best;
  }

  // The middle of the coin: a logo, straight lettering, or the logo with lettering under it, inside a circle of
  // radius R. A circle is narrower away from its middle, so every line is checked against the chord at ITS height.
  function layoutCenter(text, hasLogo, aspect, scale, R) {
    const LINE = 1.22; // line pitch, in font sizes
    const inCircle = (halfW, y0, y1) => halfW * halfW + Math.max(Math.abs(y0 - 512), Math.abs(y1 - 512)) ** 2 <= R * R;
    const options = [];
    if (text) {
      options.push({ lines: [text], firstLineWords: 0 });
      const two = splitBalanced(text);
      if (two) options.push({ lines: two.lines, firstLineWords: two.firstLineWords });
    }
    const blockOf = (lines, size) => ({ h: (lines.length - 1) * size * LINE + size * CAP, widths: lines.map((l) => textWidth(l, size)) });
    const placeLines = (lines, size, widths, topY) => lines.map((t, i) => ({ text: t, size, w: widths[i], y: topY + i * size * LINE + size * CAP }));
    const linesFit = (lines, size, widths, topY) => lines.every((_, i) => inCircle(widths[i] / 2, topY + i * size * LINE, topY + i * size * LINE + size * CAP));
    // The largest logo box of this shape whose corners stay inside the circle when its middle is `cy`
    const logoAlone = { w: (2 * R * aspect) / Math.sqrt(1 + aspect * aspect) * 0.96, h: (2 * R) / Math.sqrt(1 + aspect * aspect) * 0.96 };

    if (!text) {
      return { logo: hasLogo ? { w: logoAlone.w * scale, h: logoAlone.h * scale, cy: 512 } : null, lines: [], size: 0, firstLineWords: 0 };
    }

    if (!hasLogo) {
      // Lettering on its own, centered. Two lines only win when they are clearly bigger than one.
      const fitted = options.map((o) => {
        for (let size = o.lines.length === 1 ? 64 : 56; size >= 16; size -= 1) {
          const b = blockOf(o.lines, size);
          if (linesFit(o.lines, size, b.widths, 512 - b.h / 2)) return { ...o, size, b };
        }
        const b = blockOf(o.lines, 16);
        return { ...o, size: 16, b };
      });
      const pick = fitted[1] && fitted[1].size > fitted[0].size * 1.3 ? fitted[1] : fitted[0];
      return { logo: null, lines: placeLines(pick.lines, pick.size, pick.b.widths, 512 - pick.b.h / 2), size: pick.size, firstLineWords: pick.firstLineWords };
    }

    // Logo with lettering under it, stacked and centered as one block. Bigger lettering costs logo size and the
    // other way round, so every combination is scored and the best balance wins.
    let best = null;
    for (const o of options) {
      for (let size = 46; size >= 16; size -= 1) {
        const b = blockOf(o.lines, size);
        const gap = size * 0.55;
        const stackFits = (h) => {
          const w = h * aspect, total = h + gap + b.h, top = 512 - total / 2;
          return inCircle(w / 2, top, top + h) && linesFit(o.lines, size, b.widths, top + h + gap);
        };
        let lo = 0, hi = logoAlone.h;
        for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (stackFits(mid)) lo = mid; else hi = mid; }
        if (lo < 24) continue; // no room left for a logo at this lettering size
        const score = Math.sqrt((lo * lo * aspect) / (logoAlone.w * logoAlone.h)) * 0.6 + (size / 46) * 0.4 - (o.lines.length - 1) * 0.02;
        if (!best || score > best.score) best = { ...o, size, b, gap, h: lo, score };
      }
    }
    if (!best) { // pathological wording: fall back to the smallest lettering and whatever logo fits
      const o = options[options.length - 1], b = blockOf(o.lines, 16);
      best = { ...o, size: 16, b, gap: 9, h: 24 };
    }
    const h = best.h * scale, w = h * aspect;
    const total = h + best.gap + best.b.h, top = 512 - total / 2;
    return { logo: { w, h, cy: top + h / 2 }, lines: placeLines(best.lines, best.size, best.b.widths, top + h + best.gap), size: best.size, firstLineWords: best.firstLineWords };
  }

  // What the last drawn coin looked like: the AI prompt and the "small lettering" hint read it
  let lastLayout = null;

  function borderMarkup(r, hi, lo) {
    switch (design.border) {
      case 'rope':
        return `<circle cx="512" cy="512" r="${r}" fill="none" stroke="${lo}" stroke-width="12" stroke-dasharray="16 9" stroke-linecap="round" opacity=".85"/>` +
               `<circle cx="512" cy="512" r="${r}" fill="none" stroke="${hi}" stroke-width="4" stroke-dasharray="16 9" stroke-dashoffset="2" stroke-linecap="round" opacity=".7"/>`;
      case 'beads':
        return `<circle cx="512" cy="512" r="${r}" fill="none" stroke="${lo}" stroke-width="14" stroke-dasharray="0 24" stroke-linecap="round" opacity=".9"/>` +
               `<circle cx="512" cy="512" r="${r}" fill="none" stroke="${hi}" stroke-width="6" stroke-dasharray="0 24" stroke-dashoffset="1" stroke-linecap="round" opacity=".8"/>`;
      case 'stars': {
        const n = Math.round((2 * Math.PI * r) / 34);
        const stars = Array.from({ length: n }, () => '★').join(' ');
        return `<path id="starPath" d="M ${512 - r},512 A ${r},${r} 0 1,1 ${512 + r},512 A ${r},${r} 0 1,1 ${512 - r},512" fill="none"/>` +
               `<text font-family="Georgia, 'Times New Roman', serif" font-size="22" fill="${lo}" opacity=".9"><textPath href="#starPath" startOffset="0">${stars}</textPath></text>`;
      }
      default:
        return `<circle cx="512" cy="512" r="${r}" fill="none" stroke="${lo}" stroke-width="3" opacity=".6"/>`;
    }
  }

  // `proof: true` draws the art proof sent to the AI: same layout, but with solid, high-contrast lettering.
  // The soft embossed lettering of the on-screen preview is pretty, but it is exactly what image models misread.
  function coinSvg({ proof = false } = {}) {
    const [hi, mid, lo] = finishOf(design.finish).colors;
    const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
    const ink = lum(mid) < 0.38 ? '#F5F5F5' : '#111111';
    const clean = (t) => t.replace(/\s+/g, ' ').trim().toUpperCase();
    const top = clean(design.topText), bottom = clean(design.bottomText), center = clean(design.centerText);
    const hasRim = !!(top || bottom);

    // The decorative ring moves out to the edge when there is no rim lettering; the middle gets the room
    const ringR = hasRim ? 348 : 396;
    const fieldR = ringR - 24;
    const rim = layoutRim(top, bottom);
    const mid2 = layoutCenter(center, !!design.logo, design.logoAspect || 1, design.logoSize / 100, fieldR);
    lastLayout = { rim, center: mid2 };

    // Raised lettering: a light copy nudged up-left under the dark one. The art proof uses flat ink instead.
    // Lettering over a colored field is drawn as bright metal standing above the enamel (shadow down-right) instead.
    const fieldInk = design.bgColor ? (lum(design.bgColor) < 0.45 ? '#F5F5F5' : '#111111') : ink;
    const lettering = (attrs, inner, size, track, onColor = false) => {
      const common = `${attrs} font-family="${FONT}" font-weight="bold" font-size="${size}" letter-spacing="${(size * track).toFixed(2)}" text-anchor="middle"`;
      if (proof) return `<text ${common} fill="${onColor ? fieldInk : ink}">${inner}</text>`;
      return onColor
        ? `<text ${common} fill="#000" opacity=".55" transform="translate(2.5,3)">${inner}</text><text ${common} fill="${hi}">${inner}</text>`
        : `<text ${common} fill="${hi}" opacity=".9" transform="translate(-2,-2)">${inner}</text><text ${common} fill="${lo}">${inner}</text>`;
    };

    // The center background: everything inside the decorative ring, behind the logo and the center lettering
    const bgR = ringR - 7;
    const texture = () => {
      const light = proof ? '#fff' : hi, dark = proof ? '#000' : lo;
      switch (design.bgTexture) {
        case 'sunburst': {
          const n = 96, rays = [];
          for (let i = 0; i < n; i++) {
            const a0 = (i / n) * 2 * Math.PI, a1 = ((i + 1) / n) * 2 * Math.PI;
            const pt = (a) => `${(512 + bgR * Math.sin(a)).toFixed(1)},${(512 - bgR * Math.cos(a)).toFixed(1)}`;
            rays.push(`<path d="M512,512 L${pt(a0)} A${bgR},${bgR} 0 0,1 ${pt(a1)} Z" fill="${i % 2 ? dark : light}" opacity="${i % 2 ? 0.2 : 0.16}"/>`);
          }
          return rays.join('');
        }
        case 'diamond':
          return `<rect x="${512 - bgR}" y="${512 - bgR}" width="${2 * bgR}" height="${2 * bgR}" fill="url(#texDiamond)"/>`;
        case 'sandblast':
          return `<rect x="${512 - bgR}" y="${512 - bgR}" width="${2 * bgR}" height="${2 * bgR}" fill="url(#texSand)"/>`;
        default:
          return '';
      }
    };
    const background = !hasBackground() ? '' : `<g clip-path="url(#bgClip)">`
      + (design.bgColor ? `<circle cx="512" cy="512" r="${bgR}" fill="${design.bgColor}"/>` : '')
      + texture()
      // enamel is glossy: a soft highlight top-left, and a darker edge where it meets the metal wall
      + (design.bgColor && !proof ? `<circle cx="512" cy="512" r="${bgR}" fill="url(#enamelGloss)"/>` : '')
      + `</g>` + (proof ? '' : `<circle cx="512" cy="512" r="${bgR - 2}" fill="none" stroke="#000" stroke-width="5" opacity=".28"/>`);

    // A full circle that starts opposite the lettering, so the middle of the wording sits at 50% of the path
    // and long wording can never run off the end of it (the old half-circle paths cut it off).
    const legend = (id, l, outward) => {
      if (!l) return '';
      const r = l.r.toFixed(1);
      const d = outward
        ? `M 512,${512 + l.r} A ${r},${r} 0 1,1 512,${512 - l.r} A ${r},${r} 0 1,1 512,${512 + l.r}`
        : `M 512,${512 - l.r} A ${r},${r} 0 1,0 512,${512 + l.r} A ${r},${r} 0 1,0 512,${512 - l.r}`;
      return `<path id="${id}" d="${d}" fill="none"/>` + lettering('', `<textPath href="#${id}" startOffset="50%">${escapeXml(l.text)}</textPath>`, l.size, l.track);
    };
    const dots = rim.dots.map((p) => (proof ? '' : `<circle cx="${(p.x - 1.5).toFixed(1)}" cy="${(p.y - 1.5).toFixed(1)}" r="5.5" fill="${hi}" opacity=".9"/>`) +
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5.5" fill="${proof ? ink : lo}"/>`).join('');

    const L = mid2.logo;
    const logoMarkup = L ? `
      <image href="${design.logo}" x="${(512 - L.w / 2).toFixed(1)}" y="${(L.cy - L.h / 2).toFixed(1)}" width="${L.w.toFixed(1)}" height="${L.h.toFixed(1)}" preserveAspectRatio="xMidYMid meet" clip-path="url(#field)"${design.color === 'none' ? ` filter="url(#mono)" opacity="${proof ? 1 : 0.85}"` : ''}/>` : '';
    const centerMarkup = mid2.lines.map((l) => lettering(`x="512" y="${l.y.toFixed(1)}"`, escapeXml(l.text), l.size, TRACK, !!design.bgColor)).join('');
    const empty = !design.logo && !top && !bottom && !center;

    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bg" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#3a3d44"/><stop offset="1" stop-color="#121317"/></radialGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/></linearGradient>
    <linearGradient id="metal2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/></linearGradient>
    <clipPath id="bgClip"><circle cx="512" cy="512" r="${bgR}"/></clipPath>
    <radialGradient id="enamelGloss" cx="34%" cy="28%" r="80%"><stop offset="0" stop-color="#fff" stop-opacity=".30"/><stop offset=".45" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></radialGradient>
    <pattern id="texDiamond" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M0,0 L26,26 M26,0 L0,26" stroke="${proof ? '#000' : lo}" stroke-width="2.4" opacity=".42"/><path d="M-1,1 L25,27 M25,1 L-1,27" stroke="${proof ? '#fff' : hi}" stroke-width="1.2" opacity=".4"/></pattern>
    <pattern id="texSand" width="18" height="18" patternUnits="userSpaceOnUse">${[[2, 3], [9, 1], [14, 5], [5, 8], [11, 10], [16, 13], [1, 14], [7, 16], [13, 17], [4, 12], [17, 8], [8, 5]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 1 : 1.4}" fill="${i % 2 ? (proof ? '#000' : lo) : (proof ? '#fff' : hi)}" opacity=".5"/>`).join('')}</pattern>
    <radialGradient id="fieldFill" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/></radialGradient>
    <clipPath id="field"><circle cx="512" cy="512" r="${fieldR + 8}"/></clipPath>
    <filter id="mono"><feColorMatrix type="saturate" values="0"/></filter>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000" flood-opacity=".7"/></filter>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <circle cx="512" cy="512" r="470" fill="url(#metal)" filter="url(#shadow)"/>
  <circle cx="512" cy="512" r="470" fill="none" stroke="${lo}" stroke-width="6" stroke-dasharray="4 6" opacity=".8"/>
  <circle cx="512" cy="512" r="440" fill="url(#metal2)"/>
  <circle cx="512" cy="512" r="412" fill="${lo}" opacity=".55"/>
  <circle cx="512" cy="512" r="404" fill="url(#fieldFill)"/>
  ${background}
  ${borderMarkup(ringR, hi, lo)}
  ${legend('topArc', rim.top, true)}
  ${legend('bottomArc', rim.bottom, false)}
  ${dots}
  ${logoMarkup}
  ${centerMarkup}
  ${empty ? `<text x="512" y="500" font-family="${FONT}" font-size="30" letter-spacing="6" text-anchor="middle" fill="${lo}" opacity=".8">YOUR LOGO</text><text x="512" y="548" font-family="${FONT}" font-size="22" letter-spacing="4" text-anchor="middle" fill="${lo}" opacity=".6">AND TEXT HERE</text>` : ''}
  <circle cx="512" cy="512" r="404" fill="none" stroke="${hi}" stroke-width="3" opacity=".6"/>
</svg>`;
  }

  function designSignature() {
    return JSON.stringify({ ...design, logo: design.logo ? design.logo.length + design.logoName : null });
  }

  let renderTimer = null;
  function renderPreview() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      $('preview-svg').innerHTML = coinSvg();
      // A design change puts you back on the layout; earlier renders stay in the versions strip
      const v = currentVersion();
      if (v && v.signature !== designSignature()) {
        ai.current = null;
        setView('layout');
        $('preview-caption').textContent = 'Design changed. Your earlier AI versions are kept below; tap one to go back to it.';
        renderVersions();
      }
      $('shape-note').hidden = design.shape !== 'odd';
      $('preview-spec').textContent = specLine();
      updateTextHint();
      syncBackground();
      updateDesignReady();
    }, 60);
  }

  // Lettering shrinks to fit. On a 1.75" coin, 36 units of the 1024-unit layout is lettering about 1 mm tall,
  // which is near the limit of what reads well in struck metal, so the customer is told before it gets smaller.
  function updateTextHint() {
    const l = lastLayout;
    const small = [];
    if (l && l.rim.top && l.rim.top.size < 36) small.push('top text');
    if (l && l.rim.bottom && l.rim.bottom.size < 36) small.push('bottom text');
    if (l && l.center.lines.length && l.center.size < 30) small.push('center text');
    const hint = $('text-hint');
    hint.hidden = !small.length;
    if (small.length) hint.textContent = `That is a lot of lettering: the ${small.join(' and ')} had to be made small to fit. Shorter wording will be bolder and easier to read on the finished coin.`;
  }

  // One-line summary of the choices, shown under the coin
  function specLine() {
    return [finishOf(design.finish).label, COLOR_SHORT[design.color], SHAPES[design.shape], backgroundLabel()].filter(Boolean).join(' · ');
  }

  function designReady() {
    return !!(design.logo || design.topText.trim() || design.bottomText.trim() || design.centerText.trim());
  }
  function updateDesignReady() {
    const ready = designReady();
    $('to-options').disabled = !ready;
    $('design-hint').textContent = ready
      ? 'Looking good. Tap "Let AI Finish It" for a realistic render, or continue to order this design.'
      : 'Add a logo or some text to get started.';
  }

  // Rasterize the SVG preview to a PNG data URL (used for AI input, download, and the order record)
  function rasterize(svg, size = 1024) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        c.getContext('2d').drawImage(img, 0, 0, size, size);
        try { resolve(c.toDataURL('image/png')); } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('Could not render the preview'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  const layoutPng = () => rasterize(coinSvg());
  const proofPng = () => rasterize(coinSvg({ proof: true }), 1536);
  const usingAi = () => !!(currentVersion() && ai.view === 'ai');
  async function currentImage() {
    return usingAi() ? currentVersion().image : layoutPng();
  }

  // ---------- preview view (layout vs AI) ----------
  function setView(view) {
    ai.view = currentVersion() ? view : 'layout';
    $('preview-tabs').hidden = !currentVersion();
    renderCheck();
    $('preview-svg').hidden = ai.view === 'ai';
    $('preview-ai').hidden = ai.view !== 'ai';
    for (const b of $('preview-tabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.view === ai.view);
  }
  $('preview-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) setView(b.dataset.view);
  });

  // ---------- AI render ----------
  const cloneDesign = () => ({ ...design });

  // Cloudflare Turnstile (only when the server has TURNSTILE_SITE_KEY): every render carries a fresh token
  // proving it came from a real browser. Invisible to genuine visitors; scripts hitting /api/generate get refused.
  const turnstile = { widget: null, loading: null };
  function turnstileToken() {
    if (!config.turnstileSiteKey) return Promise.resolve('');
    if (!turnstile.loading) {
      turnstile.loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load the bot check. Please reload the page.'));
        document.head.appendChild(s);
      });
    }
    return turnstile.loading.then(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The bot check timed out. Please try again.')), 30000);
      const done = (token) => { clearTimeout(timer); resolve(token); };
      const fail = () => { clearTimeout(timer); reject(new Error('The bot check failed. Please reload the page and try again.')); };
      if (turnstile.widget == null) {
        let host = $('turnstile-host');
        if (!host) { host = document.createElement('div'); host.id = 'turnstile-host'; document.body.appendChild(host); }
        turnstile.widget = window.turnstile.render(host, {
          sitekey: config.turnstileSiteKey, size: 'invisible', execution: 'execute',
          callback: (t) => turnstile.resolve && turnstile.resolve(t),
          'error-callback': () => turnstile.reject && turnstile.reject(),
          'expired-callback': () => {},
        });
      } else {
        window.turnstile.reset(turnstile.widget);
      }
      turnstile.resolve = done;
      turnstile.reject = fail;
      window.turnstile.execute(turnstile.widget);
    }));
  }

  async function aiRender() {
    if (ai.busy) return;
    if (!designReady()) { toast('Add a logo or some text first.'); return; }
    if (isTest()) {
      toast('<span class="test-tag">TEST</span> Test mode: AI render skipped. Your layout is used as the coin.');
      return;
    }
    ai.busy = true;
    $('ai-btn').disabled = true;
    $('preview-busy').hidden = false;
    const snapshot = cloneDesign();
    const signature = designSignature();
    try {
      const [blob, token] = await Promise.all([fetch(await proofPng()).then((r) => r.blob()), turnstileToken()]);
      const form = new FormData();
      form.append('image', blob, 'art-proof.png');
      if (token) form.append('turnstile', token);
      form.append('finish', snapshot.finish);
      form.append('color', snapshot.color);
      form.append('shape', snapshot.shape);
      form.append('border', snapshot.border);
      form.append('bgColor', snapshot.bgColor);
      form.append('bgColorName', snapshot.bgColor ? bgColorName(snapshot.bgColor) : '');
      form.append('bgTexture', snapshot.bgTexture);
      form.append('topText', snapshot.topText);
      form.append('bottomText', snapshot.bottomText);
      form.append('centerText', snapshot.centerText);
      form.append('hasLogo', snapshot.logo ? '1' : '0');
      form.append('centerFirstLineWords', String(lastLayout ? lastLayout.center.firstLineWords : 0));
      const res = await fetch('/api/generate', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Render failed');
      const version = { id: 'v' + ai.nextNumber, number: ai.nextNumber++, image: data.image, renderId: data.renderId || null, check: data.check || null, demo: data.provider === 'demo', design: snapshot, signature };
      ai.versions.push(version);
      // Keep the strip (and the browser's memory) bounded: drop the oldest version that is not on screen
      while (ai.versions.length > MAX_VERSIONS) ai.versions.splice(ai.versions.findIndex((v) => v.id !== ai.current), 1);
      // If the design was edited while this was rendering, keep the version but stay on the layout
      if (signature === designSignature()) showVersion(version.id);
      else { renderVersions(); toast(`AI version ${version.number} is ready. Tap it under the coin to see it.`, 5000); }
    } catch (e) {
      toast(escapeHtml(e.message || 'Sorry, the AI render failed. Please try again.'), 5000);
    } finally {
      ai.busy = false;
      $('ai-btn').disabled = false;
      $('preview-busy').hidden = true;
    }
  }

  // Show a version. If it was made from a different design, the design comes back with it,
  // so the picture, the form, and the order always describe the same coin.
  function showVersion(id) {
    const v = ai.versions.find((x) => x.id === id);
    if (!v) return;
    if (v.signature !== designSignature()) {
      Object.assign(design, v.design);
      syncControls();
      $('preview-svg').innerHTML = coinSvg();
      $('shape-note').hidden = design.shape !== 'odd';
      $('preview-spec').textContent = specLine();
      updateDesignReady();
    }
    ai.current = id;
    $('preview-ai').src = v.image;
    $('preview-ai').alt = `AI version ${v.number} of your coin`;
    setView('ai');
    $('preview-caption').textContent = v.demo
      ? 'Demo render (add an API key on the server for real AI renders).'
      : `AI version ${v.number}, shown with a light preview watermark. The artwork made for your order is clean and full quality.`;
    renderVersions();
  }

  function removeVersion(id) {
    ai.versions = ai.versions.filter((v) => v.id !== id);
    if (ai.current === id) {
      ai.current = null;
      setView('layout');
      $('preview-caption').textContent = 'Your coin updates as you type.';
    }
    renderVersions();
  }

  const checkState = (v) => (!v.check || !v.check.checked ? 'unchecked' : v.check.ok ? 'ok' : 'warn');

  function renderVersions() {
    const wrap = $('versions-wrap');
    wrap.hidden = !ai.versions.length;
    // Shorter label on phones, where the button shares a row with Download in the pinned bar
    $('ai-btn').innerHTML = ai.versions.length ? '<span class="only-wide">Make Another Version</span><span class="only-narrow">New Version</span>' : 'Let AI Finish It';
    $('versions').innerHTML = ai.versions.map((v) => {
      const state = checkState(v);
      const label = `AI version ${v.number}` + (state === 'ok' ? ', wording checked' : state === 'warn' ? ', needs a look' : '');
      return `<button type="button" class="version${v.id === ai.current ? ' on' : ''} ${state}" data-version="${v.id}" aria-pressed="${v.id === ai.current}" aria-label="${label}" title="${label}">` +
        `<img src="${v.image}" alt=""><span class="num">${v.number}</span>${state === 'unchecked' ? '' : `<span class="flag" aria-hidden="true">${state === 'ok' ? '✓' : '!'}</span>`}</button>`;
    }).join('');
    renderCheck();
  }
  $('versions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-version]');
    if (b) showVersion(b.dataset.version);
  });

  // The proofreading result for the version on screen, in plain words
  function renderCheck() {
    const box = $('ai-check');
    const v = currentVersion();
    if (!v || ai.view !== 'ai') { box.hidden = true; return; }
    const state = checkState(v);
    const c = v.check || {};
    let html = '';
    if (state === 'ok') {
      html = '<strong>✓ Wording checked.</strong><span class="more"> We read this render back letter by letter and it matches what you typed' + (c.logoMatch != null ? ', and your logo held up well.' : '.') + '</span>';
    } else if (state === 'warn') {
      const issues = [];
      for (const l of c.lines || []) if (!l.ok) issues.push(`it wrote “${escapeHtml(l.read || 'nothing')}” where you typed “${escapeHtml(l.expected)}”`);
      if ((c.extraText || []).length) issues.push(`it added “${escapeHtml(c.extraText.join('”, “'))}”`);
      if (c.logoOk === false) issues.push('it changed your logo' + (c.logoIssues ? ` (${escapeHtml(c.logoIssues)})` : ''));
      html = `<strong>! This version is not quite right:</strong> ${issues.join('; ') || 'something is off'}.` +
        '<span class="more"> Make another version for a fresh one. Your real coin is made from your exact wording and logo file, never from this picture.</span>';
    }
    box.className = 'ai-check ' + state;
    box.innerHTML = html + (html ? ' ' : '') + `<button type="button" class="link" id="remove-version">Remove version ${v.number}</button>`;
    box.hidden = false;
    $('remove-version').addEventListener('click', () => removeVersion(v.id));
  }

  $('ai-btn').addEventListener('click', aiRender);

  // ---------- download & image protection ----------
  // AI renders are watermarked on the server (the clean file never reaches the browser). The flat layout is drawn
  // here, so it is watermarked here: it is only a mock-up, but it should still carry the name.
  function watermarkLayout(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not prepare the image'));
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const u = c.width / 1024;
        ctx.save();
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate((-28 * Math.PI) / 180);
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        for (let row = -6; row <= 6; row++) {
          for (let col = -3; col <= 3; col++) {
            const x = col * 520 * u + (row % 2 ? 260 * u : 0), y = row * 150 * u;
            const big = row % 2 === 0;
            ctx.font = `bold ${Math.round((big ? 38 : 24) * u)}px Arial, Helvetica, sans-serif`;
            ctx.lineWidth = 3 * u;
            ctx.strokeStyle = 'rgba(0,0,0,.30)';
            ctx.fillStyle = 'rgba(255,255,255,.34)';
            const text = big ? 'COINS FOR ANYTHING' : 'coinsforanything.com';
            ctx.strokeText(text, x, y);
            ctx.fillText(text, x, y);
          }
        }
        ctx.restore();
        const band = Math.round(46 * u);
        ctx.fillStyle = 'rgba(0,0,0,.84)'; ctx.fillRect(0, c.height - band, c.width, band);
        ctx.fillStyle = '#F58220'; ctx.fillRect(0, c.height - band, c.width, Math.max(2, Math.round(3 * u)));
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.font = `bold ${Math.round(18 * u)}px Arial, Helvetica, sans-serif`;
        ctx.fillText('PREVIEW ONLY  ·  COINS FOR ANYTHING  ·  coinsforanything.com  ·  NOT FOR PRODUCTION', c.width / 2, c.height - band / 2 + 6 * u);
        resolve(c.toDataURL('image/png'));
      };
      img.src = dataUrl;
    });
  }

  function saveAs(url, name) {
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // Used only when the server has no email set up: a watermarked file straight to the device
  async function downloadDesign() {
    const name = `coins-for-anything-${design.finish}-preview.png`;
    const v = usingAi() ? currentVersion() : null;
    if (v && v.renderId) {
      const res = await fetch(`/api/renders/${v.renderId}/download`);
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Could not prepare the download.'); }
      const url = URL.createObjectURL(await res.blob());
      saveAs(url, name);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } else {
      saveAs(await watermarkLayout(v ? v.image : await layoutPng()), name);
    }
    toast('Downloaded with a preview watermark. The artwork for your order is clean and full quality.', 4500);
  }

  // ---------- "email me this design" ----------
  // The design is sent to the customer's inbox in exchange for their address (a lead for the sales team), instead of
  // being handed to the browser. The server watermarks whatever it sends.
  const send = { root: $('send'), form: $('send-form'), done: $('send-done'), error: $('send-error'), submit: $('send-submit'), opener: null, busy: false };
  async function openSend() {
    if (!designReady()) { toast('Add a logo or some text first.'); return; }
    send.opener = document.activeElement;
    send.form.hidden = false; send.done.hidden = true; send.error.hidden = true;
    send.form.elements.email.classList.remove('bad');
    if (!send.form.elements.email.value) send.form.elements.email.value = order.email || '';
    if (!send.form.elements.name.value) send.form.elements.name.value = (order.name || '').split(' ')[0];
    try { $('send-coin').src = await currentImage(); } catch (_) {}
    send.root.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => send.form.elements.email.focus(), 50);
  }
  function closeSend() {
    send.root.hidden = true;
    document.body.style.overflow = '';
    if (send.opener && send.opener.focus) send.opener.focus();
  }
  $('download-btn').addEventListener('click', openSend);
  $('send-close').addEventListener('click', closeSend);
  $('send-finish').addEventListener('click', closeSend);
  send.root.addEventListener('click', (e) => { if (e.target === send.root) closeSend(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !send.root.hidden) closeSend(); });
  send.form.addEventListener('input', () => { send.form.elements.email.classList.remove('bad'); send.error.hidden = true; });

  send.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (send.busy) return;
    const email = send.form.elements.email.value.trim();
    const name = send.form.elements.name.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      send.form.elements.email.classList.add('bad');
      send.error.textContent = 'Please enter a valid email address.';
      send.error.hidden = false;
      send.form.elements.email.focus();
      return;
    }
    send.busy = true;
    send.submit.disabled = true;
    send.submit.innerHTML = 'Sending… <span class="typing"><i></i><i></i><i></i></span>';
    try {
      const v = usingAi() ? currentVersion() : null;
      const res = await fetch('/api/send-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, name, newsletter: send.form.elements.newsletter.checked, test: isTest(),
          renderId: v ? v.renderId : null,
          image: v && v.renderId ? null : (v ? v.image : await layoutPng()),
          design: { finish: design.finish, color: design.color, shape: design.shape, bgColor: design.bgColor, bgColorName: design.bgColor ? bgColorName(design.bgColor) : '', bgTexture: design.bgTexture,
            topText: design.topText, bottomText: design.bottomText, centerText: design.centerText, logoName: design.logoName },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send the email.');

      // They will not have to type it again at checkout
      if (!order.email) { order.email = email; if (!form.elements.email.value) form.elements.email.value = email; }
      if (name && !order.name && !form.elements.name.value) form.elements.name.value = name;

      if (data.fallback === 'download') { closeSend(); await downloadDesign(); return; }
      $('send-done-text').innerHTML = data.test
        ? `<span class="test-tag">TEST</span> Test mode: no email was sent. The request for <strong>${escapeHtml(email)}</strong> was saved in leads/.`
        : `We sent your design to <strong>${escapeHtml(email)}</strong>. It can take a minute; if you do not see it, check your spam folder.`;
      send.form.hidden = true;
      send.done.hidden = false;
      $('send-finish').focus();
    } catch (err) {
      send.error.textContent = err.message || 'Could not send the email. Please try again.';
      send.error.hidden = false;
    } finally {
      send.busy = false;
      send.submit.disabled = false;
      send.submit.textContent = 'Email My Design';
    }
  });

  // Coin images cannot be right-clicked, long-pressed or dragged out of the page. This only stops casual saving
  // (a screenshot is always possible), which is why everything that reaches the browser is watermarked already.
  const isCoinImage = (t) => !!(t && t.closest && t.closest('.preview-col, .review-coin, .co-summary, .versions'));
  document.addEventListener('contextmenu', (e) => { if (isCoinImage(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => { if (e.target.tagName === 'IMG' || isCoinImage(e.target)) e.preventDefault(); });

  // ---------- design controls ----------
  const logoDrop = $('logo-drop');
  const logoFile = $('logo-file');

  // Logo files rarely arrive coin-ready: they have wide empty margins (so the logo lands tiny on the coin)
  // and JPGs carry a white box that would sit on the metal like a sticker. This trims the margins and makes a
  // plain background transparent. Only background connected to the image border is removed, so white areas
  // inside the artwork are left alone. If anything goes wrong the original file is used untouched.
  function prepareLogo(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        try {
          const scale = Math.min(1, 1200 / Math.max(img.naturalWidth || 1200, img.naturalHeight || 1200));
          const w = Math.max(1, Math.round((img.naturalWidth || 1200) * scale));
          const h = Math.max(1, Math.round((img.naturalHeight || 1200) * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, w, h);
          const px = ctx.getImageData(0, 0, w, h);
          const d = px.data;

          // A plain background shows up as four opaque corners of (nearly) the same color
          const corner = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
          const corners = [corner(0, 0), corner(w - 1, 0), corner(0, h - 1), corner(w - 1, h - 1)];
          const bg = corners[0];
          const near = (r, g, b, tol) => Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) <= tol;
          const plainBg = corners.every((k) => k[3] > 250 && near(k[0], k[1], k[2], 24));
          if (plainBg) {
            // Flood fill inward from every border pixel
            const seen = new Uint8Array(w * h);
            const stack = [];
            const push = (x, y) => { const n = y * w + x; if (!seen[n]) { seen[n] = 1; stack.push(n); } };
            for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
            for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
            while (stack.length) {
              const n = stack.pop();
              const i = n * 4;
              if (d[i + 3] < 8 || !near(d[i], d[i + 1], d[i + 2], 60)) continue;
              // Soft edge: pixels close to the background color fade out instead of leaving a hard halo
              const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
              d[i + 3] = dist <= 30 ? 0 : Math.round(((dist - 30) / 30) * 255);
              if (dist > 30) continue;
              const x = n % w, y = (n - x) / w;
              if (x > 0) push(x - 1, y);
              if (x < w - 1) push(x + 1, y);
              if (y > 0) push(x, y - 1);
              if (y < h - 1) push(x, y + 1);
            }
            ctx.putImageData(px, 0, 0);
          }

          // Trim to the artwork
          let x0 = w, y0 = h, x1 = -1, y1 = -1;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            if (d[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          }
          if (x1 < 0) return resolve(dataUrl); // nothing visible left: keep the original
          const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02);
          x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
          const out = document.createElement('canvas');
          out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
          out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
          resolve(out.toDataURL('image/png'));
        } catch (_) { resolve(dataUrl); }
      };
      img.src = dataUrl;
    });
  }

  // Width / height of the prepared logo, kept within sane bounds
  function imageAspect(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(Math.max(0.2, Math.min(5, (img.naturalWidth || 1) / (img.naturalHeight || 1))));
      img.onerror = () => resolve(1);
      img.src = url;
    });
  }

  function setLogo(file) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/i.test(file.type)) { toast('Please use a PNG, JPG, WEBP, or SVG image.'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('Please keep the image under 10 MB.'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      design.logo = await prepareLogo(reader.result);
      design.logoAspect = await imageAspect(design.logo);
      design.logoName = file.name;
      $('logo-thumb').src = design.logo;
      $('logo-name').textContent = file.name;
      logoDrop.querySelector('.logo-empty').hidden = true;
      logoDrop.querySelector('.logo-have').hidden = false;
      renderPreview();
    };
    reader.readAsDataURL(file);
  }
  function clearLogo() {
    design.logo = null; design.logoName = ''; design.logoAspect = 1;
    logoDrop.querySelector('.logo-empty').hidden = false;
    logoDrop.querySelector('.logo-have').hidden = true;
    renderPreview();
  }
  logoDrop.addEventListener('click', (e) => { if (!e.target.closest('#logo-remove')) logoFile.click(); });
  logoDrop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); logoFile.click(); } });
  logoFile.addEventListener('change', () => { setLogo(logoFile.files && logoFile.files[0]); logoFile.value = ''; });
  $('logo-remove').addEventListener('click', (e) => { e.stopPropagation(); clearLogo(); });

  for (const [id, key] of [['text-top', 'topText'], ['text-bottom', 'bottomText'], ['text-center', 'centerText']]) {
    $(id).addEventListener('input', (e) => { design[key] = e.target.value; renderPreview(); });
  }
  $('logo-size').addEventListener('input', (e) => { design.logoSize = +e.target.value; renderPreview(); });

  const finishesEl = $('finishes');
  for (const f of FINISHES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch-btn' + (f.key === design.finish ? ' on' : '');
    b.dataset.finish = f.key;
    b.innerHTML = `<span class="dot" style="background:linear-gradient(135deg,${f.colors[0]},${f.colors[1]} 55%,${f.colors[2]})"></span>${f.label}`;
    b.addEventListener('click', () => {
      design.finish = f.key;
      for (const x of finishesEl.children) x.classList.toggle('on', x === b);
      renderPreview();
    });
    finishesEl.appendChild(b);
  }
  // Single-choice segmented controls: color and shape
  for (const [id, attr] of [['colors', 'color'], ['shapes', 'shape']]) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest(`button[data-${attr}]`);
      if (!b) return;
      design[attr] = b.dataset[attr];
      for (const x of $(id).children) x.classList.toggle('on', x === b);
      // A bare-metal coin cannot have an enamel background (a struck texture is still fine)
      if (attr === 'color' && design.color === 'none' && design.bgColor) { design.bgColor = ''; syncBackground(); toast('No Color means bare metal, so the colored background was removed. Textures still work.'); }
      renderPreview();
    });
  }

  // Center background: color chips (None, the enamel palette, any custom color) and a texture choice
  const bgColorsEl = $('bg-colors');
  function contrast(a, b) {
    const L = (hex) => { const n = parseInt(hex.slice(1), 16); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
    const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }
  function syncBackground() {
    const custom = design.bgColor && !BG_COLORS.some((c) => c.hex.toLowerCase() === design.bgColor.toLowerCase());
    for (const x of bgColorsEl.querySelectorAll('[data-bg]')) x.classList.toggle('on', x.dataset.bg.toLowerCase() === design.bgColor.toLowerCase());
    const chip = bgColorsEl.querySelector('.bg-custom');
    chip.classList.toggle('on', !!custom);
    chip.style.setProperty('--picked', custom ? design.bgColor : 'transparent');
    for (const x of $('bg-textures').children) x.classList.toggle('on', x.dataset.texture === design.bgTexture);
    const note = $('bg-note');
    const tex = BG_TEXTURES[design.bgTexture].toLowerCase(), col = bgColorName(design.bgColor).toLowerCase();
    let text = '';
    if (design.bgColor && design.bgTexture !== 'smooth') text = `Translucent ${col} enamel over a ${tex} texture: the texture shows through the color.`;
    else if (design.bgColor) text = `Glossy ${col} enamel fills the center, with your logo and lettering standing above it in raised metal.`;
    else if (design.bgTexture !== 'smooth') text = `A ${tex} texture is struck into the metal behind your design.`;
    // Raised metal lettering over an enamel of nearly the same brightness is hard to read on the real coin too
    if (design.bgColor && design.centerText.trim() && contrast(finishOf(design.finish).colors[0], design.bgColor) < 1.7) text += ' Heads up: this color is close to your metal finish, so the center lettering will be hard to read.';
    note.textContent = text;
    note.hidden = !text;
  }
  function setBgColor(hex) {
    design.bgColor = hex;
    if (hex && design.color === 'none') {
      design.color = 'color-one';
      for (const x of $('colors').children) x.classList.toggle('on', x.dataset.color === design.color);
      toast('A colored background needs color, so Color was switched to One Side.');
    }
    syncBackground();
    renderPreview();
  }
  bgColorsEl.innerHTML = `<button type="button" class="bg-swatch bg-none" data-bg="" aria-label="No background color" title="None"></button>`
    + BG_COLORS.map((c) => `<button type="button" class="bg-swatch" data-bg="${c.hex}" style="--chip:${c.hex}" aria-label="${c.name}" title="${c.name}"></button>`).join('')
    + `<label class="bg-swatch bg-custom" title="Pick any color"><input id="bg-custom" type="color" value="#1F4FA3" aria-label="Custom background color"><span aria-hidden="true">+</span></label>`;
  bgColorsEl.addEventListener('click', (e) => { const b = e.target.closest('[data-bg]'); if (b) setBgColor(b.dataset.bg); });
  $('bg-custom').addEventListener('input', (e) => setBgColor(e.target.value));
  $('bg-textures').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-texture]');
    if (!b) return;
    design.bgTexture = b.dataset.texture;
    syncBackground();
    renderPreview();
  });
  const addonsEl = $('addons');
  function syncAddons() {
    for (const x of addonsEl.querySelectorAll('button')) {
      const on = x.dataset.addon ? order.addons.includes(x.dataset.addon)
        : !order.addons.some((k) => (addonOf(k) || {}).group === x.dataset.none);
      x.classList.toggle('on', on);
      x.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  function setAddon(key, on) {
    const a = addonOf(key);
    // Turning one on clears the other option in its group
    order.addons = order.addons.filter((k) => k !== key && !(on && a.group && addonOf(k).group === a.group));
    if (on) order.addons.push(key);
    order.addons.sort((x, y) => ADDONS.indexOf(addonOf(x)) - ADDONS.indexOf(addonOf(y))); // catalog order, not click order
    syncAddons();
  }
  (function buildAddons() {
    const price = (a) => (a.price ? `<small>${escapeHtml(a.price)}</small>` : '');
    for (const [group, g] of Object.entries(ADDON_GROUPS)) {
      const row = document.createElement('div');
      row.className = 'addon-row';
      row.innerHTML = `<div class="addon-info"><strong>${escapeHtml(g.label)}</strong><span>${escapeHtml(g.desc)}</span></div>` +
        `<div class="seg" role="group" aria-label="${escapeHtml(g.label)}"><button type="button" data-none="${group}">None</button>` +
        ADDONS.filter((a) => a.group === group).map((a) => `<button type="button" data-addon="${a.key}">${escapeHtml(a.option)} ${price(a)}</button>`).join('') + '</div>';
      addonsEl.appendChild(row);
    }
    const tiles = document.createElement('div');
    tiles.className = 'addon-tiles';
    tiles.innerHTML = ADDONS.filter((a) => !a.group).map((a) =>
      `<button type="button" class="addon-tile" data-addon="${a.key}"><span class="tick" aria-hidden="true"></span>` +
      `<span class="addon-info"><strong>${escapeHtml(a.label)}</strong><span>${escapeHtml(a.desc)}</span>${price(a)}</span></button>`).join('');
    addonsEl.appendChild(tiles);
    addonsEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.none) {
        order.addons = order.addons.filter((k) => addonOf(k).group !== b.dataset.none);
        syncAddons();
      } else {
        const a = addonOf(b.dataset.addon);
        setAddon(a.key, a.group ? true : !order.addons.includes(a.key));
      }
    });
    syncAddons();
  })();
  $('borders').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-border]');
    if (!b) return;
    design.border = b.dataset.border;
    for (const x of $('borders').children) x.classList.toggle('on', x === b);
    renderPreview();
  });

  // Page-wide drag & drop and paste for the logo
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0; $('drop').hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) { setLogo(f); showStep('design'); }
  });
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) { setLogo(it.getAsFile()); showStep('design'); break; }
    }
  });

  // ---------- steps ----------
  const STEPS = ['design', 'options', 'details', 'review'];
  let stepShown = false; // skip the focus move on first load
  function showStep(name) {
    for (const s of document.querySelectorAll('.panel .step')) s.hidden = s.dataset.step !== name;
    const idx = STEPS.indexOf(name);
    for (const li of $('stepper').children) {
      const i = STEPS.indexOf(li.dataset.step);
      li.classList.toggle('current', li.dataset.step === name);
      li.classList.toggle('done', idx >= 0 && i < idx);
      li.style.cursor = '';
      // Finished steps are links back; make them reachable by keyboard and named for screen readers
      if (li.classList.contains('done')) { li.tabIndex = 0; li.setAttribute('role', 'button'); } else { li.removeAttribute('tabindex'); li.removeAttribute('role'); }
      if (li.dataset.step === name) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    }
    $('builder').dataset.step = name;
    if (!currentVersion()) {
      $('preview-caption').textContent = name === 'design' ? 'Your coin updates as you type.' : 'This is the design you are ordering.';
    }
    if (name === 'review') renderReview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Move focus to the new step's heading so keyboard and screen-reader users land in the right place
    const h = document.querySelector(`.panel .step[data-step="${name}"] h2`);
    if (h && stepShown) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    stepShown = true;
  }
  $('stepper').addEventListener('click', (e) => {
    const li = e.target.closest('li.done');
    if (li && !$('result').innerHTML) showStep(li.dataset.step);
  });
  $('stepper').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('li.done')) { e.preventDefault(); e.target.click(); }
  });
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => showStep(b.dataset.back)));
  $('to-options').addEventListener('click', () => showStep('options'));
  $('to-details').addEventListener('click', () => { if (order.quantity && order.size) showStep('details'); });

  // ---------- step 2: quantity & size ----------
  const qtyChips = $('qty-chips');
  for (const q of QUANTITIES) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = q.toLocaleString(); b.dataset.qty = q;
    b.addEventListener('click', () => { setQuantity(q); $('qty-input').value = ''; });
    qtyChips.appendChild(b);
  }
  $('qty-input').addEventListener('input', (e) => {
    const q = parseInt(e.target.value, 10);
    setQuantity(q > 0 && q <= 100000 ? q : null);
  });
  function setQuantity(q) {
    order.quantity = q;
    for (const b of qtyChips.children) b.classList.toggle('on', +b.dataset.qty === q);
    updateEstimate();
  }
  const sizeChips = $('size-chips');
  for (const s of SIZES) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = s + '"'; b.dataset.size = s;
    b.addEventListener('click', () => setSize(s));
    sizeChips.appendChild(b);
  }
  function setSize(s) {
    order.size = s;
    for (const b of sizeChips.children) b.classList.toggle('on', b.dataset.size === s);
    updateEstimate();
  }
  $('notes').addEventListener('input', (e) => { order.notes = e.target.value; });

  async function updateEstimate() {
    const ok = !!(order.quantity && order.size);
    $('to-details').disabled = !ok;
    order.estimate = null;
    const box = $('estimate');
    if (!ok) { box.hidden = true; updateOrderButton(); return; }
    await configReady;
    if (!config.pricing) {
      box.innerHTML = '<small>Our team confirms exact pricing by email, usually within one business day.</small>';
      box.hidden = false;
      updateOrderButton();
      return;
    }
    try {
      const r = await fetch(`/api/quote?size=${encodeURIComponent(order.size)}&quantity=${order.quantity}`);
      const d = await r.json();
      if (d.estimate) {
        order.estimate = d.estimate;
        box.innerHTML = `<div class="big">${money(d.estimate.total)}</div><small>${order.quantity.toLocaleString()} × ${order.size}" ${escapeHtml(finishOf(design.finish).label)} coins at ${money(d.estimate.unit)} each. Shipping and any setup fees are confirmed by our team.</small>`;
        box.hidden = false;
      }
    } catch (_) { box.hidden = true; }
    updateOrderButton();
  }

  // ---------- step 3: details form ----------
  const form = $('details-form');
  const same = form.elements.same;
  const syncShip = () => { $('ship-fields').hidden = same.checked; };
  same.addEventListener('change', syncShip);
  syncShip();
  form.addEventListener('input', (e) => {
    if (e.target && e.target.classList) e.target.classList.remove('bad');
    if (!form.querySelector('input.bad')) $('details-error').hidden = true;
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = (n) => form.elements[n].value.trim();
    const next = {
      name: v('name'), email: v('email'), phone: v('phone'), company: v('company'),
      billStreet: v('billStreet'), billCityStateZip: v('billCityStateZip'), billCountry: v('billCountry'),
    };
    if (same.checked) { next.street = next.billStreet; next.cityStateZip = next.billCityStateZip; next.country = next.billCountry; }
    else { next.street = v('street'); next.cityStateZip = v('cityStateZip'); next.country = v('country'); }

    const required = [
      ['name', 'your name'], ['email', 'your email'],
      ['billStreet', 'billing street address'], ['billCityStateZip', 'billing city, state, ZIP'], ['billCountry', 'billing country'],
      ['street', 'shipping street address'], ['cityStateZip', 'shipping city, state, ZIP'], ['country', 'shipping country'],
    ];
    const missing = [];
    for (const [id, label] of required) {
      const skip = same.checked && ['street', 'cityStateZip', 'country'].includes(id);
      const bad = !skip && !next[id];
      form.elements[id].classList.toggle('bad', bad);
      if (bad) missing.push(label);
    }
    if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) { form.elements.email.classList.add('bad'); missing.push('a valid email'); }
    const err = $('details-error');
    if (missing.length) {
      err.textContent = 'Please add: ' + missing.join(', ') + '.';
      err.hidden = false;
      return;
    }
    err.hidden = true;
    Object.assign(order, next);
    showStep('review');
  });

  // ---------- step 4: review ----------
  function updateOrderButton() {
    $('place-order').textContent = isTest() ? 'Place Test Order' : (config.payments && order.estimate ? 'Pay Now' : 'Send to Coins for Anything');
  }

  async function renderReview() {
    updateOrderButton();
    const o = order;
    const sameAddr = o.street === o.billStreet && o.cityStateZip === o.billCityStateZip && o.country === o.billCountry;
    const edit = (step) => `<button class="link" type="button" data-edit="${step}">Edit</button>`;
    const texts = [design.topText, design.centerText, design.bottomText].map((t) => t.trim()).filter(Boolean).map((t) => `“${escapeHtml(t.toUpperCase())}”`).join(' · ');
    const rows = [
      ['Coin', `<div class="review-coin"><img id="review-img" alt="Your coin"><ul>` +
               [finishOf(design.finish).label, COLORS[design.color], `${SHAPES[design.shape]}, ${design.border} rim`, backgroundLabel(),
                design.logo ? `Logo: ${design.logoName}` : '',
                usingAi() ? `AI version ${currentVersion().number} selected` : 'Your layout selected'].filter(Boolean).map((t) => `<li>${escapeHtml(t)}</li>`).join('') +
               `</ul></div>${edit('design')}`],
      texts ? ['Text', texts] : null,
      ['Quantity', `${o.quantity.toLocaleString()} × ${o.size}" ${edit('options')}`],
      order.addons.length ? ['Add-ons', order.addons.map((k) => escapeHtml(addonOf(k).label) + (addonOf(k).price ? ` <small>${escapeHtml(addonOf(k).price)}</small>` : '')).join('<br>') + ` ${edit('options')}`] : null,
      o.estimate ? ['Estimate', `${money(o.estimate.total)} (${money(o.estimate.unit)} each)`] : null,
      ['Contact', `${escapeHtml(o.name)}<br>${escapeHtml(o.email)}${o.phone ? '<br>' + escapeHtml(o.phone) : ''}${o.company ? '<br>' + escapeHtml(o.company) : ''} ${edit('details')}`],
      ['Bill to', `${escapeHtml(o.billStreet)}<br>${escapeHtml(o.billCityStateZip)}<br>${escapeHtml(o.billCountry)}`],
      ['Ship to', sameAddr ? 'Same as billing' : `${escapeHtml(o.street)}<br>${escapeHtml(o.cityStateZip)}<br>${escapeHtml(o.country)}`],
      o.notes.trim() ? ['Notes', escapeHtml(o.notes.trim())] : null,
    ].filter(Boolean);
    const table = $('review-table');
    table.innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
    table.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => showStep(b.dataset.edit)));
    try { $('review-img').src = await currentImage(); } catch (_) {}
  }

  $('place-order').addEventListener('click', placeOrder);

  async function placeOrder() {
    if (busy) return;
    busy = true;
    const btn = $('place-order');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    $('review-error').hidden = true;
    try {
      const image = await currentImage();
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finish: design.finish,
          size: order.size,
          quantity: order.quantity,
          name: order.name, email: order.email, phone: order.phone, company: order.company,
          billStreet: order.billStreet, billCityStateZip: order.billCityStateZip, billCountry: order.billCountry,
          street: order.street, cityStateZip: order.cityStateZip, country: order.country,
          notes: order.notes,
          design: {
            topText: design.topText, bottomText: design.bottomText, centerText: design.centerText,
            color: design.color, shape: design.shape, addons: order.addons,
            bgColor: design.bgColor, bgColorName: design.bgColor ? bgColorName(design.bgColor) : '', bgTexture: design.bgTexture,
            border: design.border, logoName: design.logoName, aiRendered: usingAi(),
            aiVersion: usingAi() ? currentVersion().number : null, renderId: usingAi() ? currentVersion().renderId : null, aiVersionsMade: ai.nextNumber - 1,
            aiWordingChecked: usingAi() && currentVersion().check && currentVersion().check.checked ? !!currentVersion().check.ok : null,
          },
          image,
          test: isTest(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not place the order');

      if (data.test) {
        await runTestCheckout(data.orderId, image);
        return;
      }
      if (data.checkoutUrl) {
        btn.textContent = 'Opening secure checkout…';
        await sleep(500);
        window.location.href = data.checkoutUrl;
        return;
      }
      showResult(
        `<p class="head"><span class="script">Thank you</span> so much for your business!</p>` +
        `<p>Your coin request <strong>${escapeHtml(data.orderId)}</strong> has been sent to the <strong>Coins for Anything team for review</strong>. ` +
        `We'll be in touch at <strong>${escapeHtml(order.email)}</strong> ${order.estimate ? 'with your invoice and next steps' : 'with pricing and next steps'} within one business day.</p>` +
        '<p>The Quality is Always Here.</p>'
      );
    } catch (e) {
      const err = $('review-error');
      err.textContent = e.message || 'Something went wrong. Please try again.';
      err.hidden = false;
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function showResult(html) {
    $('result').innerHTML = html;
    $('builder').dataset.step = 'result';
    if (!currentVersion()) $('preview-caption').textContent = 'Your coin design.';
    for (const s of document.querySelectorAll('.panel .step')) s.hidden = s.dataset.step !== 'result';
    for (const li of $('stepper').children) { li.classList.remove('current'); li.classList.add('done'); li.style.cursor = 'default'; }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- test checkout popup ----------
  const co = {
    root: $('checkout'), form: $('co-form'), done: $('co-done'), close: $('co-close'),
    finish: $('co-finish'), pay: $('co-pay'), error: $('co-error'),
  };
  function cardBrand(d) {
    if (/^4/.test(d)) return 'Visa';
    if (/^(5[1-5]|2[2-7])/.test(d)) return 'Mastercard';
    if (/^3[47]/.test(d)) return 'American Express';
    if (/^6(011|5)/.test(d)) return 'Discover';
    return 'Card';
  }
  function luhnOk(d) {
    let sum = 0, dbl = false;
    for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (dbl) { n *= 2; if (n > 9) n -= 9; } sum += n; dbl = !dbl; }
    return sum % 10 === 0;
  }
  co.form.addEventListener('input', (e) => {
    if (e.target && e.target.classList) e.target.classList.remove('bad');
    if (!co.form.querySelector('input.bad')) co.error.hidden = true;
  });
  co.form.elements.cardNumber.addEventListener('input', (e) => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 19);
    e.target.value = d.replace(/(\d{4})(?=\d)/g, '$1 ');
  });
  co.form.elements.cardExp.addEventListener('input', (e) => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 4);
    e.target.value = d.length > 2 ? d.slice(0, 2) + ' / ' + d.slice(2) : d;
  });
  co.form.elements.cardCvc.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });

  // Opens the popup; resolves with { paid, last4, brand } when it closes
  function openTestCheckout(orderId, image) {
    return new Promise((resolve) => {
      const o = order;
      const sample = !o.estimate;
      const amount = o.estimate ? o.estimate.total : Math.round(o.quantity * 6.95 * 100) / 100;
      $('co-coin').src = image || '';
      $('co-item').innerHTML = `<strong>${o.quantity.toLocaleString()} × Custom ${escapeHtml(o.size)}" ${escapeHtml(finishOf(design.finish).label)} Coin</strong><br>` +
        `<span style="color:#999">Order ${escapeHtml(orderId)}${o.estimate ? ` &middot; ${money(o.estimate.unit)} each` : ''}</span>`;
      $('co-subtotal').textContent = money(amount);
      $('co-total').textContent = money(amount);
      $('co-note').textContent = sample ? 'Sample price shown because no PRICE_TABLE is configured. Test mode only.' : 'Shipping and any setup fees are confirmed by our team.';
      co.form.reset();
      $('co-email').value = o.email;
      co.form.elements.cardName.value = o.name;
      co.pay.textContent = `Pay ${money(amount)}`;
      co.pay.disabled = false;
      co.error.hidden = true;
      for (const i of co.form.querySelectorAll('input')) i.classList.remove('bad');
      co.form.hidden = false;
      co.done.hidden = true;
      co.root.hidden = false;
      document.body.style.overflow = 'hidden';
      setTimeout(() => co.form.elements.cardNumber.focus(), 50);

      let settled = false, paidResult = null;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        co.root.hidden = true;
        document.body.style.overflow = '';
        co.close.removeEventListener('click', onCancel);
        co.finish.removeEventListener('click', onFinish);
        co.form.removeEventListener('submit', onSubmit);
        co.root.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        resolve(result);
      };
      const onCancel = () => finish(paidResult || { paid: false });
      const onFinish = () => finish(paidResult);
      const onBackdrop = (e) => { if (e.target === co.root) onCancel(); };
      const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
      const onSubmit = async (e) => {
        e.preventDefault();
        const f = co.form.elements;
        const digits = f.cardNumber.value.replace(/\D/g, '');
        const exp = f.cardExp.value.replace(/\D/g, '');
        const problems = [];
        const mark = (input, bad, msg) => { input.classList.toggle('bad', bad); if (bad) problems.push(msg); };
        mark(f.cardName, !f.cardName.value.trim(), 'the name on the card');
        mark(f.cardNumber, digits.length < 13 || digits.length > 19 || !luhnOk(digits), 'a valid card number');
        let expBad = exp.length !== 4;
        if (!expBad) {
          const mm = +exp.slice(0, 2), yy = 2000 + +exp.slice(2), now = new Date();
          expBad = mm < 1 || mm > 12 || yy < now.getFullYear() || (yy === now.getFullYear() && mm < now.getMonth() + 1);
        }
        mark(f.cardExp, expBad, 'a valid expiry date');
        mark(f.cardCvc, !/^\d{3,4}$/.test(f.cardCvc.value.trim()), 'the CVC');
        mark(f.cardZip, f.cardZip.value.trim().length < 3, 'the billing ZIP');
        if (problems.length) { co.error.textContent = 'Please check ' + problems.join(', ') + '.'; co.error.hidden = false; return; }
        co.error.hidden = true;
        co.pay.disabled = true;
        co.pay.innerHTML = 'Processing… <span class="typing"><i></i><i></i><i></i></span>';
        await sleep(1400);
        paidResult = { paid: true, last4: digits.slice(-4), brand: cardBrand(digits) };
        $('co-done-text').innerHTML = `${money(amount)} paid with ${escapeHtml(paidResult.brand)} ending in <strong>${paidResult.last4}</strong> for order <strong>${escapeHtml(orderId)}</strong>.<br>` +
          '<span style="color:#888;font-size:13px">Test mode: no real charge was made.</span>';
        co.form.hidden = true;
        co.done.hidden = false;
        co.finish.focus();
      };
      co.close.addEventListener('click', onCancel);
      co.finish.addEventListener('click', onFinish);
      co.form.addEventListener('submit', onSubmit);
      co.root.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);
    });
  }

  async function runTestCheckout(orderId, image) {
    const result = await openTestCheckout(orderId, image);
    fetch(`/api/orders/${encodeURIComponent(orderId)}/test-payment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paid: !!result.paid, last4: result.last4 || '', brand: result.brand || '' }),
    }).catch(() => {});
    if (result.paid) {
      showResult(
        `<p class="head"><span class="script">Thank you</span> for your order! <span class="test-tag">TEST</span></p>` +
        `<p>Payment received for order <strong>${escapeHtml(orderId)}</strong> (${escapeHtml(result.brand)} ending in ${escapeHtml(result.last4)}). ` +
        `A receipt would go to <strong>${escapeHtml(order.email)}</strong>, and our team would be in touch about production and shipping.</p>` +
        '<p class="caption">Test mode: no real charge was made. The order is saved in orders/ with status test_paid.</p>'
      );
    } else {
      const err = $('review-error');
      err.innerHTML = `Checkout was closed for test order <strong>${escapeHtml(orderId)}</strong>. No charge was made. <button class="link" type="button" id="retry-pay">Open checkout again</button>`;
      err.hidden = false;
      $('retry-pay').addEventListener('click', () => { err.hidden = true; runTestCheckout(orderId, image); });
    }
  }

  // ---------- returning from Stripe ----------
  function handleReturnFromCheckout() {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order');
    if (!orderId) return false;
    const paid = params.get('paid') === '1';
    history.replaceState(null, '', window.location.pathname);
    fetch(`/api/orders/${encodeURIComponent(orderId)}/paid`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paid }),
    }).catch(() => {});
    showResult(paid
      ? `<p class="head"><span class="script">Thank you</span> for your order!</p><p>Payment received for order <strong>${escapeHtml(orderId)}</strong>. A receipt is on its way to your inbox, and our team will be in touch about production and shipping.</p>`
      : `<p class="head">Checkout cancelled</p><p>No charge was made for order <strong>${escapeHtml(orderId)}</strong>. Our team still has your request and will follow up by email.</p>`);
    return true;
  }

  // ---------- form controls <- design state ----------
  function syncControls() {
    $('text-top').value = design.topText; $('text-bottom').value = design.bottomText; $('text-center').value = design.centerText;
    $('logo-size').value = design.logoSize;
    logoDrop.querySelector('.logo-empty').hidden = !!design.logo;
    logoDrop.querySelector('.logo-have').hidden = !design.logo;
    if (design.logo) { $('logo-thumb').src = design.logo; $('logo-name').textContent = design.logoName; }
    for (const x of finishesEl.children) x.classList.toggle('on', x.dataset.finish === design.finish);
    for (const x of $('colors').children) x.classList.toggle('on', x.dataset.color === design.color);
    for (const x of $('shapes').children) x.classList.toggle('on', x.dataset.shape === design.shape);
    for (const x of $('borders').children) x.classList.toggle('on', x.dataset.border === design.border);
    syncBackground();
  }

  // ---------- restart ----------
  function restart() {
    Object.assign(design, newDesign());
    Object.assign(order, { quantity: null, size: null, estimate: null, notes: '', addons: [], name: '', email: '', phone: '', company: '', billStreet: '', billCityStateZip: '', billCountry: 'United States', street: '', cityStateZip: '', country: 'United States' });
    ai.versions = []; ai.current = null; ai.nextNumber = 1;
    $('result').innerHTML = '';
    $('notes').value = ''; $('qty-input').value = '';
    syncControls();
    syncAddons();
    for (const b of qtyChips.children) b.classList.remove('on');
    for (const b of sizeChips.children) b.classList.remove('on');
    $('estimate').hidden = true;
    $('to-details').disabled = true;
    form.reset(); syncShip();
    $('details-error').hidden = true; $('review-error').hidden = true;
    setView('layout');
    renderVersions();
    $('preview-caption').textContent = 'Your coin updates as you type.';
    renderPreview();
    showStep('design');
  }
  $('restart').addEventListener('click', restart);
  $('another').addEventListener('click', restart);

  // Choice buttons show their state with the `on` class; mirror it to aria-pressed for screen readers
  const CHOICES = '.seg button, .swatch-btn, .addon-tile, .preview-tabs button, .version, button.bg-swatch';
  const markPressed = (b) => b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false');
  new MutationObserver((muts) => { for (const m of muts) if (m.target.matches && m.target.matches(CHOICES)) markPressed(m.target); })
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  document.querySelectorAll(CHOICES).forEach(markPressed);

  // ---------- boot ----------
  renderPreview();
  if (!handleReturnFromCheckout()) showStep('design');
})();
