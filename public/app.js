(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // The customer tells us what the coin is for and describes each face in their own words. There are no option
  // grids: the server turns the description into the AI prompt, and the artists finish the coin before production.
  const SIZES = ['1.5', '1.75', '2', '2.5', '3'];
  const QUANTITIES = [50, 100, 250, 500, 1000];

  const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

  // ---------- state ----------
  const config = { pricing: false, payments: false, testMode: false, provider: '' };
  // backMode: 'same' (the back is the front again) or 'custom' (its own description, rendered to match the front)
  // shape: 'round' or 'odd' (a custom outline: shield, star, state, cut to the artwork; the words say which)
  const newDesign = () => ({ front: '', back: '', backMode: 'same', shape: 'round', style: '', logo: null, logoName: '' });
  const design = newDesign();
  const order = {
    quantity: null, size: null, estimate: null, notes: '',
    name: '', email: '', phone: '', company: '',
    billStreet: '', billCityStateZip: '', billCountry: 'United States',
    street: '', cityStateZip: '', country: 'United States',
  };
  // Every AI render is kept as a version, per face: the picture, the proofreading result, and the description it was
  // made from. A back version also remembers which front render it was drawn to match; it only counts while that
  // front is the one on screen.
  const MAX_VERSIONS = 8;
  const newSide = () => ({ versions: [], current: null, nextNumber: 1 });
  const ai = { busy: false, side: 'front', front: newSide(), back: newSide() };
  const sideCurrent = (side) => ai[side].versions.find((v) => v.id === ai[side].current) || null;
  const currentFront = () => sideCurrent('front');
  const currentBack = () => sideCurrent('back');
  const frontRenderId = () => { const f = currentFront(); return f ? f.renderId : null; };
  const frontKey = () => { const f = currentFront(); return f ? f.id : null; }; // which front version a back was drawn for
  const backStale = (v) => v.frontKey !== frontKey();
  const currentVersion = currentFront; // the order, the contact form and checkout are anchored on the front
  let busy = false;
  const customBack = () => design.backMode === 'custom';
  const oddShape = () => design.shape === 'odd';
  const twoSided = () => customBack() && !!design.back.trim();
  // The design as the server records it on renders, orders and leads
  const designPayload = () => ({ shape: design.shape, front: design.front.trim(), back: twoSided() ? design.back.trim() : '', backMode: design.backMode, style: design.style.trim(), logoName: design.logoName });

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
  // In test mode: no AI call (a placeholder stands in for the render), orders are saved as
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

  // ---------- the design form ----------
  for (const [id, key] of [['desc-front', 'front'], ['desc-back', 'back'], ['desc-style', 'style']]) {
    $(id).addEventListener('input', (e) => { design[key] = e.target.value; syncDesign(); });
  }
  $('back-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    design.backMode = b.dataset.mode;
    syncDesign();
    if (customBack()) $('desc-back').focus();
  });
  $('coin-shape').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-shape]');
    if (!b) return;
    design.shape = b.dataset.shape === 'odd' ? 'odd' : 'round';
    syncShape();
    syncDesign();
  });
  function syncShape() {
    for (const x of $('coin-shape').children) x.classList.toggle('on', x.dataset.shape === design.shape);
    $('shape-hint').textContent = oddShape()
      ? 'Say what shape in your description or style notes: a shield, a star, your state, or cut to your logo. Left unsaid, we cut it to your artwork.'
      : 'Round is the classic challenge coin.';
    // An odd-shaped coin has no diameter: its size is the longest side, which is what it is priced by
    $('size-measure').textContent = oddShape() ? 'longest side, needed for pricing' : 'diameter, needed for pricing';
    $('size-hint').textContent = oddShape()
      ? 'Measure the longest side of the shape. Most coins are 1.75" or 2" across. Need another size? Tell us in the notes when you order.'
      : 'Most challenge coins are 1.75" or 2". Need another size? Tell us in the notes when you order.';
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
    syncDesign();
    updateEstimate();
  }

  const designReady = () => !!design.front.trim();
  function specLine() {
    return [order.size ? `${order.size}"` : '', oddShape() ? 'Odd shaped' : '', twoSided() ? 'Front & back' : 'Same both sides', design.logoName ? 'Your logo' : ''].filter(Boolean).join(' · ');
  }
  // What a render of each face depends on. A back render is also tied to the front render it was matched against.
  const logoKey = () => (design.logo ? design.logo.length : 0);
  const frontSignature = () => JSON.stringify({ shape: design.shape, front: design.front.trim(), style: design.style.trim(), logoName: design.logoName, logo: logoKey() });
  const backSignature = () => JSON.stringify({ shape: design.shape, back: design.back.trim(), style: design.style.trim(), logoName: design.logoName, logo: logoKey(), front: frontKey() });
  const sideSignature = (side) => (side === 'back' ? backSignature() : frontSignature());

  // A design change means the render on screen no longer matches; earlier versions stay in the strip.
  // Each step's footer offers exactly one next move: generate this face, or go on.
  function syncDesign() {
    $('preview-spec').textContent = specLine();
    for (const side of ['front', 'back']) {
      const v = sideCurrent(side);
      if (v && v.signature !== sideSignature(side)) ai[side].current = null;
      // Back to a description (or, for the back, a front) that was rendered before: that version comes back on its own
      if (!sideCurrent(side)) { const again = [...ai[side].versions].reverse().find((x) => x.signature === sideSignature(side)); if (again) ai[side].current = again.id; }
    }
    const front = currentFront();
    const back = currentBack();
    const ready = designReady();

    // Front step: describe, generate, then on to the back with the render on screen
    $('generate-btn').disabled = !ready || ai.busy;
    $('generate-btn').hidden = !!front;
    $('to-back').hidden = !front;
    $('to-back').disabled = !(front && order.size);
    $('design-hint').textContent = !design.front.trim()
      ? 'Describe the front of your coin: what goes on it, and where.'
      : !front
        ? (ai.front.versions.length ? 'The description changed. Tap "Generate This Coin" to render it again.' : 'Looking good. Tap "Generate This Coin" to see it rendered.')
        : !order.size
          ? 'Pick a coin size, then continue to the back of your coin.'
          : 'Happy with the front? Continue to the back. Not quite? Change the description or make another version.';

    // Back step: "same as the front" needs nothing more; a different back has to be generated to match the front
    const backText = design.back.trim();
    $('back-custom').hidden = !customBack();
    for (const b of $('back-mode').children) b.classList.toggle('on', b.dataset.mode === design.backMode);
    const backDone = !customBack() || !!back;
    $('back-generate-btn').hidden = backDone;
    $('back-generate-btn').disabled = !backText || !front || ai.busy;
    $('to-options').hidden = !backDone;
    $('back-hint').textContent = !front
      ? 'Generate the front first; the back is drawn to match it.'
      : !customBack()
        ? 'The back will carry the same design as the front. Continue to your order, or choose "A different design".'
        : !backText
          ? 'Describe the back: what goes on it, and where.'
          : !back
            ? (ai.back.versions.length ? 'The back or the front changed. Tap "Generate the Back" to render it again to match.' : 'Tap "Generate the Back" to see it rendered to match your front.')
            : 'Happy with it? Continue to your order. Not quite? Change the description or make another version.';
    renderPreview();
    renderVersions();
  }

  // ---------- logo ----------
  const logoDrop = $('logo-drop');
  const logoFile = $('logo-file');

  // Logo files rarely arrive coin-ready: they have wide empty margins and JPGs carry a white box that would sit on
  // the metal like a sticker. This trims the margins and makes a plain background transparent. Only background
  // connected to the image border is removed, so white areas inside the artwork are left alone.
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
          const corner = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
          const corners = [corner(0, 0), corner(w - 1, 0), corner(0, h - 1), corner(w - 1, h - 1)];
          const bg = corners[0];
          const near = (r, g, b, tol) => Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) <= tol;
          const plainBg = corners.every((k) => k[3] > 250 && near(k[0], k[1], k[2], 24));
          if (plainBg) {
            const seen = new Uint8Array(w * h);
            const stack = [];
            const push = (x, y) => { const n = y * w + x; if (!seen[n]) { seen[n] = 1; stack.push(n); } };
            for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
            for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
            while (stack.length) {
              const n = stack.pop();
              const i = n * 4;
              if (d[i + 3] < 8 || !near(d[i], d[i + 1], d[i + 2], 60)) continue;
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
          let x0 = w, y0 = h, x1 = -1, y1 = -1;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            if (d[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          }
          if (x1 < 0) return resolve(dataUrl);
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
  function setLogo(file) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/i.test(file.type)) { toast('Please use a PNG, JPG, WEBP, or SVG image.'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('Please keep the image under 10 MB.'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      design.logo = await prepareLogo(reader.result);
      design.logoName = file.name;
      $('logo-thumb').src = design.logo;
      $('logo-name').textContent = file.name;
      logoDrop.querySelector('.logo-empty').hidden = true;
      logoDrop.querySelector('.logo-have').hidden = false;
      syncDesign();
    };
    reader.readAsDataURL(file);
  }
  function clearLogo() {
    design.logo = null; design.logoName = '';
    logoDrop.querySelector('.logo-empty').hidden = false;
    logoDrop.querySelector('.logo-have').hidden = true;
    syncDesign();
  }
  logoDrop.addEventListener('click', (e) => { if (!e.target.closest('#logo-remove')) logoFile.click(); });
  logoDrop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); logoFile.click(); } });
  logoFile.addEventListener('change', () => { setLogo(logoFile.files && logoFile.files[0]); logoFile.value = ''; });
  $('logo-remove').addEventListener('click', (e) => { e.stopPropagation(); clearLogo(); });

  // Page-wide drag & drop and paste for the logo
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0; $('drop').hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) { setLogo(f); showStep('front'); }
  });
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) { setLogo(it.getAsFile()); showStep('front'); break; }
    }
  });

  // ---------- the render on screen ----------
  // One coin on the front step. From the back step on, both faces side by side: the front on the left and, on the
  // right, the back render, or the front again (dimmed) when the back is "same as the front".
  function renderPreview() {
    const front = currentFront();
    const back = currentBack();
    const two = $('builder').dataset.step !== 'front';
    $('stage').classList.toggle('two', two);
    document.querySelector('.preview').classList.toggle('two', two);
    const setFace = (face, v, { same = false, hint = '' } = {}) => {
      const el = $('face-' + face);
      const img = el.querySelector('img');
      el.classList.toggle('same', same);
      if (v) { img.src = v.image; img.hidden = false; img.alt = `${face === 'front' ? 'Front' : 'Back'} of your coin, AI version ${v.number}`; }
      else { img.hidden = true; img.removeAttribute('src'); img.alt = ''; }
      el.querySelector('.face-empty').hidden = !!v;
      el.querySelector('.face-empty p').innerHTML = hint;
      el.querySelector('.face-label').textContent = face === 'front' ? 'Front' : same ? 'Back · same as front' : 'Back';
      el.querySelector('.face-label').hidden = !two;
    };
    setFace('front', front, { hint: 'Describe your coin, then tap <b>Generate This Coin</b>. Your render shows up here in a minute or two.' });
    $('face-back').hidden = !two;
    if (two) {
      if (!customBack()) setFace('back', front, { same: true, hint: 'The back matches the front.' });
      else setFace('back', back, { hint: 'Describe the back, then tap <b>Generate the Back</b>. It is drawn to match your front.' });
    }
    const shown = sideCurrent(ai.side);
    $('preview-caption').textContent = shown
      ? (shown.demo
        ? (isTest() ? 'Test mode: a stand-in for the AI render.' : 'Demo render (add an API key on the server for real AI renders).')
        : `${ai.side === 'back' ? 'Back' : 'Front'}, AI version ${shown.number}, shown with a light preview watermark. The artwork made for your order is clean and full quality.`)
      : ai.side === 'back' && !customBack() ? 'Same design on both sides.' : 'Your AI render appears here.';
  }

  // ---------- AI render ----------
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

  // Test mode stand-in for a render: a coin drawn in the browser with the description on it, no API call
  function testRenderSvg(text, label, odd = false) {
    const words = escapeXml(text.replace(/\s+/g, ' ').trim().slice(0, 80));
    // An odd-shaped coin is drawn as an octagon so the shape choice can be seen working in test mode
    const ring = (r, attrs) => odd
      ? `<polygon points="${Array.from({ length: 8 }, (_, i) => { const a = Math.PI / 8 + (i * Math.PI) / 4; return `${(512 + r * Math.cos(a)).toFixed(1)},${(512 + r * Math.sin(a)).toFixed(1)}`; }).join(' ')}" ${attrs}/>`
      : `<circle cx="512" cy="512" r="${r}" ${attrs}/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#1c1d21"/>
  ${ring(440, 'fill="#c9971c"')}${ring(380, 'fill="#b8871a"')}${ring(380, 'fill="none" stroke="#f8e27a" stroke-width="4" opacity=".7"')}
  <text x="512" y="300" text-anchor="middle" font-family="Georgia, serif" font-size="40" letter-spacing="6" fill="#fff">${escapeXml(label)}</text>
  <text x="512" y="540" text-anchor="middle" font-family="Georgia, serif" font-size="24" fill="#fff" opacity=".9">${words}</text>
  <text x="512" y="760" text-anchor="middle" font-family="Georgia, serif" font-size="34" letter-spacing="6" fill="#f8e27a">TEST RENDER</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  // ---------- progress bar ----------
  // The server reports stages as it reaches them (see lib/progress.js). Within a stage the bar creeps toward that
  // stage's ceiling on a timer, so it keeps moving during the long AI calls without ever running ahead of the truth.
  const STAGES = {
    starting: { from: 2, to: 8, seconds: 4, text: 'Sending your design to the AI…' },
    rendering: { from: 8, to: 55, seconds: 45, text: 'Rendering your coin…' },
    checking: { from: 55, to: 75, seconds: 15, text: 'Reading the wording back, letter by letter…' },
    retrying: { from: 60, to: 88, seconds: 45, text: 'The wording was off, so the AI is drawing it again…' },
    finishing: { from: 90, to: 97, seconds: 6, text: 'Adding the finishing touches…' },
    done: { from: 100, to: 100, seconds: 1, text: 'Done!' },
  };
  const progress = { sides: new Map(), overall: null, timer: null, source: null };
  function progressReset() {
    progress.sides.clear(); progress.overall = null;
    progressSet('starting');
    progressTick();
    clearInterval(progress.timer);
    progress.timer = setInterval(progressTick, 250);
  }
  function progressSet(stage, side) {
    const s = STAGES[stage] || STAGES.starting;
    const entry = { stage, from: s.from, to: s.to, seconds: s.seconds, started: Date.now() };
    if (side) progress.sides.set(side, entry); else progress.overall = entry;
    if (stage === 'checking' && progress.sides.size > 1) $('progress-text').textContent = 'Reading the wording on both sides, letter by letter…';
    else if (stage === 'rendering' && progress.sides.size > 1) $('progress-text').textContent = 'Rendering the front and the back…';
    else $('progress-text').textContent = s.text;
  }
  const stagePct = (e) => e.from + (e.to - e.from) * (1 - Math.exp(-((Date.now() - e.started) / 1000) / (e.seconds / 2)));
  function progressTick() {
    // Once the sides report in, they carry the bar; before that (and at the end) the overall stage does
    const entries = progress.overall && ['finishing', 'done'].includes(progress.overall.stage) ? [progress.overall] : progress.sides.size ? [...progress.sides.values()] : [progress.overall];
    const pct = Math.round(entries.reduce((n, e) => n + stagePct(e), 0) / entries.length);
    $('progress-bar').style.width = pct + '%';
    $('progress-bar').parentElement.setAttribute('aria-valuenow', pct);
  }
  function progressListen(id) {
    if (!('EventSource' in window)) return null;
    const es = new EventSource('/api/progress/' + id);
    es.onmessage = (m) => {
      let ev; try { ev = JSON.parse(m.data); } catch (_) { return; }
      if (ev.stage === 'failed') return;
      progressSet(ev.stage, ev.side);
      progressTick();
    };
    return es;
  }
  function progressEnd() {
    clearInterval(progress.timer);
    if (progress.source) { progress.source.close(); progress.source = null; }
  }

  // note: what the customer wants different in this version (optional, from the "Make Another Version" popup)
  async function aiRender(side, note = '') {
    if (ai.busy) return;
    note = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (side === 'front' && !designReady()) { toast('Describe the front of your coin first.'); return; }
    if (side === 'back' && !currentFront()) { toast('Generate the front first; the back is drawn to match it.'); return; }
    if (side === 'back' && !design.back.trim()) { toast('Describe the back first.'); return; }
    ai.busy = true;
    ai.side = side;
    const genBtn = $(side === 'back' ? 'back-generate-btn' : 'generate-btn');
    const genLabel = genBtn.textContent;
    $('ai-btn').disabled = true;
    genBtn.disabled = true;
    genBtn.textContent = 'Generating…';
    $('preview-busy').dataset.face = side;
    $('preview-busy').hidden = false;
    progressReset();
    const snapshot = { ...designPayload(), logo: design.logo };
    const text = side === 'back' ? snapshot.back : snapshot.front;
    const signature = sideSignature(side);
    const anchor = frontRenderId(); // the front this back is drawn to match
    const anchorKey = frontKey();
    // Another version of a face already rendered: tell the server not to hand back the cached one
    const fresh = ai[side].versions.some((v) => v.signature === signature);
    try {
      let data;
      if (isTest()) {
        for (const stage of ['rendering', 'checking', 'finishing']) { progressSet(stage); progressTick(); await sleep(700); }
        data = { image: testRenderSvg(text, side.toUpperCase(), snapshot.shape === 'odd'), renderId: 'test-' + side + '-' + ai[side].nextNumber, check: null, provider: 'test' };
      } else {
        const token = await turnstileToken();
        const progressId = (Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-z0-9]/g, '');
        progress.source = progressListen(progressId);
        const form = new FormData();
        if (snapshot.logo) form.append('logo', await (await fetch(snapshot.logo)).blob(), 'logo.png');
        form.append('side', side);
        form.append('description', text);
        if (note) form.append('note', note);
        form.append('shape', snapshot.shape);
        form.append('style', snapshot.style);
        if (side === 'back') form.append('frontRenderId', anchor || '');
        form.append('progressId', progressId);
        if (fresh) form.append('fresh', '1');
        if (token) form.append('turnstile', token);
        const res = await fetch('/api/generate', { method: 'POST', body: form });
        data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Render failed');
      }
      progressSet('done'); progressTick();
      await sleep(350); // let the bar reach the end before the coin replaces it
      const s = ai[side];
      const version = { id: side + s.nextNumber, number: s.nextNumber++, image: data.image, renderId: data.renderId || null, check: data.check || null, demo: data.provider === 'demo' || data.provider === 'test', design: snapshot, signature, note, frontRenderId: side === 'back' ? anchor : null, frontKey: side === 'back' ? anchorKey : null };
      s.versions.push(version);
      // Keep the strip (and the browser's memory) bounded: drop the oldest version that is not on screen
      while (s.versions.length > MAX_VERSIONS) s.versions.splice(s.versions.findIndex((v) => v.id !== s.current), 1);
      // If the description was edited while this was rendering, keep the version but do not show it as current
      if (signature === sideSignature(side)) showVersion(side, version.id);
      else { syncDesign(); toast(`${side === 'back' ? 'Back' : 'Front'} version ${version.number} is ready. Tap it under the coin to see it.`, 5000); }
    } catch (e) {
      toast(escapeHtml(e.message || 'Sorry, the AI render failed. Please try again.'), 5000);
    } finally {
      progressEnd();
      ai.busy = false;
      $('ai-btn').disabled = false;
      genBtn.textContent = genLabel;
      $('preview-busy').hidden = true;
      syncDesign(); // the step's footer now offers the next move
    }
  }
  $('generate-btn').addEventListener('click', () => aiRender('front'));
  $('back-generate-btn').addEventListener('click', () => aiRender('back'));

  // Show a version. If it was made from a different description, that description comes back with it,
  // so the picture, the form, and the order always describe the same coin.
  function showVersion(side, id) {
    const s = ai[side];
    const v = s.versions.find((x) => x.id === id);
    if (!v) return;
    if (side === 'back' && backStale(v)) {
      toast('That back was drawn to match a different front. Pick that front again under the coin, or generate the back again for this one.', 6000);
      return;
    }
    if (v.signature !== sideSignature(side)) {
      const d = v.design;
      if (side === 'front') Object.assign(design, { shape: d.shape || 'round', front: d.front, style: d.style, logo: d.logo, logoName: d.logoName });
      else Object.assign(design, { back: d.back, backMode: 'custom' });
      syncControls();
    }
    s.current = id;
    ai.side = side;
    syncDesign();
  }

  function removeVersion(side, id) {
    const s = ai[side];
    s.versions = s.versions.filter((v) => v.id !== id);
    if (s.current === id) s.current = null;
    syncDesign(); // without a render on screen, the next step has to wait for a new one
  }

  const checkState = (v) => (!v.check || !v.check.checked ? 'unchecked' : v.check.ok ? 'ok' : 'warn');

  // The strip and "Make Another Version" follow the face being worked on (the front step's face, or the back step's)
  function renderVersions() {
    const side = ai.side;
    const s = ai[side];
    const wrap = $('versions-wrap');
    const active = side === 'front' || customBack();
    wrap.hidden = !s.versions.length || !active;
    $('versions-label').textContent = side === 'back' ? 'Back versions' : 'Front versions';
    $('ai-btn').hidden = !s.versions.length || !active; // the first render of a face starts from its step
    $('versions').innerHTML = s.versions.map((v) => {
      const state = checkState(v);
      const stale = side === 'back' && backStale(v);
      const label = `${side === 'back' ? 'Back' : 'Front'} version ${v.number}` + (stale ? ', drawn for a different front' : state === 'ok' ? ', wording checked' : state === 'warn' ? ', needs a look' : '') + (v.note ? `. Asked for: ${v.note}` : '');
      return `<button type="button" class="version${v.id === s.current ? ' on' : ''} ${state}${stale ? ' stale' : ''}" data-version="${v.id}" data-side="${side}" aria-pressed="${v.id === s.current}" aria-label="${label}" title="${label}">` +
        `<img src="${v.image}" alt=""><span class="num">${v.number}</span>${state === 'unchecked' || stale ? '' : `<span class="flag" aria-hidden="true">${state === 'ok' ? '✓' : '!'}</span>`}</button>`;
    }).join('');
    renderCheck();
  }
  $('versions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-version]');
    if (b) showVersion(b.dataset.side, b.dataset.version);
  });

  // The proofreading result for the version on screen, in plain words, plus the standing offer to fix it by hand
  function renderCheck() {
    const box = $('ai-check');
    const side = ai.side;
    const v = side === 'back' && !customBack() ? null : sideCurrent(side);
    $('ai-disclaimer').hidden = !v;
    if (!v) { box.hidden = true; return; }
    const state = checkState(v);
    const c = v.check || {};
    let html = '';
    if (state === 'ok') {
      html = '<strong>✓ Wording checked.</strong><span class="more"> We read this render back letter by letter and every quoted word matches' + (c.logoMatch != null ? ', and your logo held up well.' : '.') + '</span>';
    } else if (state === 'warn') {
      const issues = [];
      for (const l of c.lines || []) if (!l.ok) issues.push(`${/^(front|back) /.test(l.where) ? `on the ${l.where.split(' ')[0]} ` : ''}it wrote “${escapeHtml(l.read || 'nothing')}” where you asked for “${escapeHtml(l.expected)}”`);
      if ((c.extraText || []).length) issues.push(`it added “${escapeHtml(c.extraText.join('”, “'))}”`);
      if (c.logoOk === false) issues.push('it changed your logo' + (c.logoIssues ? ` (${escapeHtml(c.logoIssues)})` : ''));
      html = `<strong>! This version is not quite right:</strong> ${issues.join('; ') || 'something is off'}.` +
        '<span class="more"> Make another version for a fresh one, or ask us to fix it below. Your real coin is made from your exact words and logo file, never from this picture.</span>';
    }
    box.className = 'ai-check ' + state;
    box.innerHTML = html + (html ? ' ' : '') + `<button type="button" class="link" id="remove-version">Remove ${side} version ${v.number}</button>`;
    box.hidden = false;
    $('remove-version').addEventListener('click', () => removeVersion(side, v.id));
  }

  // ---------- "make another version": an optional note on what to change ----------
  const revise = { root: $('revise'), form: $('revise-form'), note: $('revise-note'), opener: null };
  function openRevise() {
    if (ai.busy) return;
    revise.opener = document.activeElement;
    revise.note.value = '';
    const v = sideCurrent(ai.side);
    $('revise-coin').src = v ? v.image : '';
    $('revise-coin').hidden = !v;
    openDialog(revise.root, revise.note);
  }
  const closeRevise = () => closeDialog(revise.root, revise.opener);
  $('ai-btn').addEventListener('click', openRevise);
  $('revise-close').addEventListener('click', closeRevise);
  revise.root.addEventListener('click', (e) => { if (e.target === revise.root) closeRevise(); });
  revise.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const note = revise.note.value;
    closeRevise();
    aiRender(ai.side, note);
  });

  // ---------- popups shared plumbing ----------
  function openDialog(root, focusEl) {
    root.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => focusEl && focusEl.focus(), 50);
  }
  function closeDialog(root, opener) {
    root.hidden = true;
    document.body.style.overflow = '';
    if (opener && opener.focus) opener.focus();
  }


  // ---------- "contact us to fix my design" ----------
  const contact = { root: $('contact'), form: $('contact-form'), done: $('contact-done'), error: $('contact-error'), submit: $('contact-submit'), opener: null, busy: false };
  function openContact() {
    contact.opener = document.activeElement;
    contact.form.hidden = false; contact.done.hidden = true; contact.error.hidden = true;
    for (const i of contact.form.querySelectorAll('input, textarea')) i.classList.remove('bad');
    const f = contact.form.elements;
    if (!f.email.value) f.email.value = order.email || '';
    if (!f.name.value) f.name.value = order.name || '';
    const v = currentVersion();
    $('contact-coin').src = v ? v.image : '';
    $('contact-coin').hidden = !v;
    openDialog(contact.root, f.message.value ? f.email : f.message);
  }
  const closeContact = () => closeDialog(contact.root, contact.opener);
  $('contact-btn').addEventListener('click', openContact);
  $('contact-close').addEventListener('click', closeContact);
  $('contact-finish').addEventListener('click', closeContact);
  contact.root.addEventListener('click', (e) => { if (e.target === contact.root) closeContact(); });
  contact.form.addEventListener('input', (e) => { if (e.target.classList) e.target.classList.remove('bad'); contact.error.hidden = true; });
  contact.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (contact.busy) return;
    const f = contact.form.elements;
    const email = f.email.value.trim(), message = f.message.value.trim();
    const problems = [];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { f.email.classList.add('bad'); problems.push('a valid email address'); }
    if (!message) { f.message.classList.add('bad'); problems.push('what you would like changed'); }
    if (problems.length) { contact.error.textContent = 'Please add ' + problems.join(' and ') + '.'; contact.error.hidden = false; return; }
    contact.busy = true;
    contact.submit.disabled = true;
    contact.submit.innerHTML = 'Sending… <span class="typing"><i></i><i></i><i></i></span>';
    try {
      const v = currentVersion();
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: f.name.value.trim(), phone: f.phone.value.trim(), message, test: isTest(), renderId: v ? v.renderId : null, design: designPayload() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send your message.');
      if (!order.email) order.email = email;
      if (f.name.value.trim() && !order.name) order.name = f.name.value.trim();
      $('contact-done-text').innerHTML = data.test
        ? `<span class="test-tag">TEST</span> Test mode: nothing was sent. The request from <strong>${escapeHtml(email)}</strong> was saved in leads/.`
        : `Thanks! A designer will look at your coin and email <strong>${escapeHtml(email)}</strong> a corrected proof within one business day.`;
      contact.form.hidden = true;
      contact.done.hidden = false;
      $('contact-finish').focus();
    } catch (err) {
      contact.error.textContent = err.message || 'Could not send your message. Please try again.';
      contact.error.hidden = false;
    } finally {
      contact.busy = false;
      contact.submit.disabled = false;
      contact.submit.textContent = 'Send to Our Designers';
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!contact.root.hidden) closeContact();
    if (!revise.root.hidden) closeRevise();
  });

  // Coin images cannot be right-clicked, long-pressed or dragged out of the page. This only stops casual saving
  // (a screenshot is always possible), which is why everything that reaches the browser is watermarked already.
  const isCoinImage = (t) => !!(t && t.closest && t.closest('.preview-col, .review-coin, .co-summary, .versions'));
  document.addEventListener('contextmenu', (e) => { if (isCoinImage(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => { if (e.target.tagName === 'IMG' || isCoinImage(e.target)) e.preventDefault(); });

  // ---------- steps ----------
  const STEPS = ['front', 'back', 'options', 'details', 'review'];
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
    if (name === 'front' || name === 'back') ai.side = name; // the strip and "Make Another Version" follow the face being worked on
    if (name === 'review') renderReview();
    syncDesign();
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
  $('to-back').addEventListener('click', () => { if (currentFront() && order.size) showStep('back'); });
  $('to-options').addEventListener('click', () => { if (currentFront() && (!customBack() || currentBack())) showStep('options'); });
  $('to-details').addEventListener('click', () => { if (order.quantity && order.size) showStep('details'); });

  // ---------- step 2: quantity ----------
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
        box.innerHTML = `<div class="big">${money(d.estimate.total)}</div><small>${order.quantity.toLocaleString()} × ${order.size}" coins at ${money(d.estimate.unit)} each. Shipping and any setup fees are confirmed by our team.</small>`;
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

  function renderReview() {
    updateOrderButton();
    const o = order;
    const v = currentFront();
    const bk = customBack() ? currentBack() : null;
    const sameAddr = o.street === o.billStreet && o.cityStateZip === o.billCityStateZip && o.country === o.billCountry;
    const edit = (step) => `<button class="link" type="button" data-edit="${step}">Edit</button>`;
    const rows = [
      ['Coin', `<div class="review-coin">${v ? '<div class="review-faces"><img id="review-img" alt="Front of your coin"><img id="review-img-back" alt="Back of your coin"></div>' : ''}<ul>` +
               [oddShape() ? 'Shape: odd shaped' : 'Shape: round', `Front: ${design.front.trim()}`, twoSided() ? `Back: ${design.back.trim()}` : 'Back: same design as the front',
                design.style.trim() ? `Style: ${design.style.trim()}` : '', design.logoName ? `Logo: ${design.logoName}` : '',
                v ? `Front: AI version ${v.number}${bk ? `. Back: AI version ${bk.number}` : ''}` : 'No AI render: our artists draw it from your description'].filter(Boolean).map((t) => `<li>${escapeHtml(t)}</li>`).join('') +
               `</ul></div>${edit('front')}`],
      ['Quantity', `${o.quantity.toLocaleString()} × ${o.size}"${oddShape() ? ' (longest side)' : ''} ${edit('options')}`],
      o.estimate ? ['Estimate', `${money(o.estimate.total)} (${money(o.estimate.unit)} each)`] : null,
      ['Contact', `${escapeHtml(o.name)}<br>${escapeHtml(o.email)}${o.phone ? '<br>' + escapeHtml(o.phone) : ''}${o.company ? '<br>' + escapeHtml(o.company) : ''} ${edit('details')}`],
      ['Bill to', `${escapeHtml(o.billStreet)}<br>${escapeHtml(o.billCityStateZip)}<br>${escapeHtml(o.billCountry)}`],
      ['Ship to', sameAddr ? 'Same as billing' : `${escapeHtml(o.street)}<br>${escapeHtml(o.cityStateZip)}<br>${escapeHtml(o.country)}`],
      o.notes.trim() ? ['Notes', escapeHtml(o.notes.trim())] : null,
    ].filter(Boolean);
    const table = $('review-table');
    table.innerHTML = rows.map(([k, val]) => `<tr><th>${k}</th><td>${val}</td></tr>`).join('');
    table.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => showStep(b.dataset.edit)));
    if (v) { $('review-img').src = v.image; $('review-img-back').src = bk ? bk.image : v.image; }
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
      const v = currentFront();
      const bk = customBack() ? currentBack() : null;
      const image = v ? v.image : null;
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          size: order.size,
          quantity: order.quantity,
          name: order.name, email: order.email, phone: order.phone, company: order.company,
          billStreet: order.billStreet, billCityStateZip: order.billCityStateZip, billCountry: order.billCountry,
          street: order.street, cityStateZip: order.cityStateZip, country: order.country,
          notes: order.notes,
          design: {
            ...designPayload(),
            aiRendered: !!v,
            aiVersion: v ? v.number : null, renderId: v ? v.renderId : null,
            backRenderId: bk ? bk.renderId : null, backVersion: bk ? bk.number : null,
            aiVersionsMade: ai.front.nextNumber - 1 + ai.back.nextNumber - 1,
            aiWordingChecked: v && v.check && v.check.checked ? !!v.check.ok : null,
          },
          image: v && v.renderId ? null : image,
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
        `We'll be in touch at <strong>${escapeHtml(order.email)}</strong> ${order.estimate ? 'with your invoice, a proof to approve, and next steps' : 'with pricing, a proof to approve, and next steps'} within one business day.</p>` +
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
      $('co-item').innerHTML = `<strong>${o.quantity.toLocaleString()} × Custom ${escapeHtml(o.size)}" Coin</strong><br>` +
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
    $('desc-front').value = design.front; $('desc-back').value = design.back; $('desc-style').value = design.style;
    for (const b of $('back-mode').children) b.classList.toggle('on', b.dataset.mode === design.backMode);
    $('back-custom').hidden = !customBack();
    syncShape();
    logoDrop.querySelector('.logo-empty').hidden = !!design.logo;
    logoDrop.querySelector('.logo-have').hidden = !design.logo;
    if (design.logo) { $('logo-thumb').src = design.logo; $('logo-name').textContent = design.logoName; }
    for (const b of sizeChips.children) b.classList.toggle('on', b.dataset.size === order.size);
  }

  // ---------- restart ----------
  function restart() {
    Object.assign(design, newDesign());
    Object.assign(order, { quantity: null, size: null, estimate: null, notes: '', name: '', email: '', phone: '', company: '', billStreet: '', billCityStateZip: '', billCountry: 'United States', street: '', cityStateZip: '', country: 'United States' });
    ai.front = newSide(); ai.back = newSide(); ai.side = 'front';
    $('result').innerHTML = '';
    $('notes').value = ''; $('qty-input').value = '';
    syncControls();
    for (const b of qtyChips.children) b.classList.remove('on');
    $('estimate').hidden = true;
    $('to-details').disabled = true;
    form.reset(); syncShip();
    $('details-error').hidden = true; $('review-error').hidden = true;
    showStep('front');
  }
  $('restart').addEventListener('click', restart);
  $('another').addEventListener('click', restart);

  // Choice buttons show their state with the `on` class; mirror it to aria-pressed for screen readers
  const CHOICES = '.seg button, .preview-tabs button, .version';
  const markPressed = (b) => b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false');
  new MutationObserver((muts) => { for (const m of muts) if (m.target.matches && m.target.matches(CHOICES)) markPressed(m.target); })
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  document.querySelectorAll(CHOICES).forEach(markPressed);

  // ---------- boot ----------
  if (!handleReturnFromCheckout()) showStep('front');
  else syncDesign();
})();
