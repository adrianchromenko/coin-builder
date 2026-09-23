(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // The customer tells us what the coin is for and describes each face in their own words. There are no option
  // grids: the server turns the description into the AI prompt, and the artists finish the coin before production.
  const PURPOSES = { celebration: 'Celebration', branding: 'Corporate branding', anniversary: 'Anniversary', souvenir: 'Event souvenir' };
  const SIZES = ['1.5', '1.75', '2', '2.5', '3'];
  const QUANTITIES = [50, 100, 250, 500, 1000];

  const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

  // ---------- state ----------
  const config = { pricing: false, payments: false, testMode: false, provider: '', purposes: PURPOSES };
  const newDesign = () => ({ purpose: '', front: '', back: '', style: '', logo: null, logoName: '' });
  const design = newDesign();
  const order = {
    quantity: null, size: null, estimate: null, notes: '',
    name: '', email: '', phone: '', company: '',
    billStreet: '', billCityStateZip: '', billCountry: 'United States',
    street: '', cityStateZip: '', country: 'United States',
  };
  // Every AI render is kept as a version: the picture, the proofreading result, and the description it was made from
  const MAX_VERSIONS = 8;
  const ai = { versions: [], current: null, nextNumber: 1, busy: false };
  const currentVersion = () => ai.versions.find((v) => v.id === ai.current) || null;
  let busy = false;
  const purposeLabel = () => config.purposes[design.purpose] || PURPOSES[design.purpose] || '';
  const twoSided = () => !!design.back.trim();
  // The design as the server records it on renders, orders and leads
  const designPayload = () => ({ purpose: design.purpose, front: design.front.trim(), back: design.back.trim(), style: design.style.trim(), logoName: design.logoName });

  const configReady = fetch('/api/config').then((r) => r.json()).then((c) => {
    Object.assign(config, c);
    if (c.purposes && Object.keys(c.purposes).length) { config.purposes = c.purposes; buildPurposes(); }
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
  function buildPurposes() {
    const el = $('purposes');
    el.innerHTML = '';
    for (const [key, label] of Object.entries(config.purposes)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.purpose = key;
      b.textContent = label;
      b.className = key === design.purpose ? 'on' : '';
      el.appendChild(b);
    }
  }
  buildPurposes();
  $('purposes').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-purpose]');
    if (!b) return;
    design.purpose = b.dataset.purpose;
    for (const x of $('purposes').children) x.classList.toggle('on', x === b);
    syncDesign();
  });
  for (const [id, key] of [['desc-front', 'front'], ['desc-back', 'back'], ['desc-style', 'style']]) {
    $(id).addEventListener('input', (e) => { design[key] = e.target.value; syncDesign(); });
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

  const designReady = () => !!(design.purpose && design.front.trim());
  function specLine() {
    return [order.size ? `${order.size}"` : '', purposeLabel(), twoSided() ? 'Front & back' : 'Same both sides', design.logoName ? 'Your logo' : ''].filter(Boolean).join(' · ');
  }
  // A design change means the render on screen no longer matches; earlier versions stay in the strip
  function syncDesign() {
    $('preview-spec').textContent = specLine();
    const v = currentVersion();
    if (v && v.signature !== designSignature()) {
      ai.current = null;
      showEmpty();
      $('preview-caption').textContent = 'Design changed. Your earlier AI versions are kept below; tap one to go back to it.';
      renderVersions();
    }
    const ready = designReady();
    // The order begins only once this exact design has been generated: the render on screen is what gets ordered.
    // Changing the description after a render brings "Generate This Coin" back until it is rendered again.
    const rendered = !!currentVersion();
    $('generate-btn').disabled = !ready || ai.busy;
    $('generate-btn').hidden = rendered;
    $('to-options').hidden = !rendered;
    $('to-options').disabled = !(rendered && order.size);
    $('design-hint').textContent = !design.purpose
      ? 'Pick what the coin is for to get started.'
      : !design.front.trim()
        ? 'Describe the front of your coin: what goes on it, and where.'
        : !rendered
          ? (ai.versions.length ? 'The description changed. Tap "Generate This Coin" to render it again before you order.' : 'Looking good. Tap "Generate This Coin" to see it rendered, then continue to your order.')
          : !order.size
            ? 'Pick a coin size to continue to your order.'
            : 'Happy with it? Continue to your order. Not quite? Change the description or make another version.';
  }
  const designSignature = () => JSON.stringify({ ...designPayload(), logo: design.logo ? design.logo.length : 0 });

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
    if (f) { setLogo(f); showStep('design'); }
  });
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) { setLogo(it.getAsFile()); showStep('design'); break; }
    }
  });

  // ---------- the render on screen ----------
  function showEmpty() {
    $('preview-empty').hidden = false;
    $('preview-ai').hidden = true;
    document.querySelector('.preview-stage').classList.remove('wide');
    renderCheck();
  }
  function showImage(v) {
    $('preview-empty').hidden = true;
    $('preview-ai').src = v.image;
    $('preview-ai').alt = `AI version ${v.number} of your coin${v.twoSided ? ', front and back' : ''}`; // the back is the front again unless it was described
    $('preview-ai').hidden = false;
    document.querySelector('.preview-stage').classList.toggle('wide', !!v.twoSided);
    renderCheck();
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
  function testRenderSvg(text, label) {
    const words = escapeXml(text.replace(/\s+/g, ' ').trim().slice(0, 80));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#1c1d21"/>
  <circle cx="512" cy="512" r="440" fill="#c9971c"/><circle cx="512" cy="512" r="380" fill="#b8871a"/><circle cx="512" cy="512" r="380" fill="none" stroke="#f8e27a" stroke-width="4" opacity=".7"/>
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

  async function aiRender() {
    if (ai.busy) return;
    if (!designReady()) { toast('Pick what the coin is for and describe the front first.'); return; }
    ai.busy = true;
    $('ai-btn').disabled = true;
    $('generate-btn').disabled = true;
    $('generate-btn').textContent = 'Generating…';
    $('preview-busy').hidden = false;
    progressReset();
    const snapshot = { ...designPayload(), logo: design.logo };
    const signature = designSignature();
    // Another version of a design already rendered: tell the server not to hand back the cached one
    const fresh = ai.versions.some((v) => v.signature === signature);
    try {
      let data;
      if (isTest()) {
        for (const stage of ['rendering', 'checking', 'finishing']) { progressSet(stage); progressTick(); await sleep(700); }
        data = { image: testRenderSvg(snapshot.front, 'FRONT'), renderId: null, twoSided: false, check: null, provider: 'test' };
      } else {
        const token = await turnstileToken();
        const progressId = (Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-z0-9]/g, '');
        progress.source = progressListen(progressId);
        const form = new FormData();
        if (snapshot.logo) form.append('logo', await (await fetch(snapshot.logo)).blob(), 'logo.png');
        form.append('purpose', snapshot.purpose);
        form.append('front', snapshot.front);
        form.append('back', snapshot.back);
        form.append('style', snapshot.style);
        form.append('progressId', progressId);
        if (fresh) form.append('fresh', '1');
        if (token) form.append('turnstile', token);
        const res = await fetch('/api/generate', { method: 'POST', body: form });
        data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Render failed');
      }
      progressSet('done'); progressTick();
      await sleep(350); // let the bar reach the end before the coin replaces it
      const version = { id: 'v' + ai.nextNumber, number: ai.nextNumber++, image: data.image, renderId: data.renderId || null, check: data.check || null, demo: data.provider === 'demo' || data.provider === 'test', twoSided: !!data.twoSided, design: snapshot, signature };
      ai.versions.push(version);
      // Keep the strip (and the browser's memory) bounded: drop the oldest version that is not on screen
      while (ai.versions.length > MAX_VERSIONS) ai.versions.splice(ai.versions.findIndex((v) => v.id !== ai.current), 1);
      // If the description was edited while this was rendering, keep the version but do not show it as current
      if (signature === designSignature()) showVersion(version.id);
      else { renderVersions(); toast(`AI version ${version.number} is ready. Tap it under the coin to see it.`, 5000); }
    } catch (e) {
      toast(escapeHtml(e.message || 'Sorry, the AI render failed. Please try again.'), 5000);
    } finally {
      progressEnd();
      ai.busy = false;
      $('ai-btn').disabled = false;
      $('generate-btn').textContent = 'Generate This Coin';
      $('preview-busy').hidden = true;
      syncDesign(); // the design step's footer now offers the order
    }
  }
  $('generate-btn').addEventListener('click', aiRender);

  // Show a version. If it was made from a different description, that description comes back with it,
  // so the picture, the form, and the order always describe the same coin.
  function showVersion(id) {
    const v = ai.versions.find((x) => x.id === id);
    if (!v) return;
    if (v.signature !== designSignature()) {
      Object.assign(design, { purpose: v.design.purpose, front: v.design.front, back: v.design.back, style: v.design.style, logo: v.design.logo, logoName: v.design.logoName });
      syncControls();
    }
    ai.current = id;
    showImage(v);
    $('preview-caption').textContent = v.demo
      ? (isTest() ? 'Test mode: a stand-in for the AI render.' : 'Demo render (add an API key on the server for real AI renders).')
      : `AI version ${v.number}, shown with a light preview watermark. The artwork made for your order is clean and full quality.`;
    renderVersions();
    syncDesign();
  }

  function removeVersion(id) {
    ai.versions = ai.versions.filter((v) => v.id !== id);
    if (ai.current === id) {
      ai.current = null;
      showEmpty();
      $('preview-caption').textContent = 'Your AI render appears here.';
    }
    renderVersions();
    syncDesign(); // without a render on screen, the order has to wait for a new one
  }

  const checkState = (v) => (!v.check || !v.check.checked ? 'unchecked' : v.check.ok ? 'ok' : 'warn');

  function renderVersions() {
    const wrap = $('versions-wrap');
    wrap.hidden = !ai.versions.length;
    $('ai-btn').hidden = !ai.versions.length; // the first render starts from the design step
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

  // The proofreading result for the version on screen, in plain words, plus the standing offer to fix it by hand
  function renderCheck() {
    const box = $('ai-check');
    const v = currentVersion();
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
    box.innerHTML = html + (html ? ' ' : '') + `<button type="button" class="link" id="remove-version">Remove version ${v.number}</button>`;
    box.hidden = false;
    $('remove-version').addEventListener('click', () => removeVersion(v.id));
  }

  $('ai-btn').addEventListener('click', aiRender);

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
  });

  // Coin images cannot be right-clicked, long-pressed or dragged out of the page. This only stops casual saving
  // (a screenshot is always possible), which is why everything that reaches the browser is watermarked already.
  const isCoinImage = (t) => !!(t && t.closest && t.closest('.preview-col, .review-coin, .co-summary, .versions'));
  document.addEventListener('contextmenu', (e) => { if (isCoinImage(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => { if (e.target.tagName === 'IMG' || isCoinImage(e.target)) e.preventDefault(); });

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
      $('preview-caption').textContent = name === 'design' ? 'Your AI render appears here.' : 'Our artists will draw this coin from your description.';
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
    const v = currentVersion();
    const sameAddr = o.street === o.billStreet && o.cityStateZip === o.billCityStateZip && o.country === o.billCountry;
    const edit = (step) => `<button class="link" type="button" data-edit="${step}">Edit</button>`;
    const rows = [
      ['Coin', `<div class="review-coin">${v ? '<img id="review-img" alt="Your coin">' : ''}<ul>` +
               [purposeLabel(), `Front: ${design.front.trim()}`, twoSided() ? `Back: ${design.back.trim()}` : 'Back: same design as the front',
                design.style.trim() ? `Style: ${design.style.trim()}` : '', design.logoName ? `Logo: ${design.logoName}` : '',
                v ? `AI version ${v.number} selected` : 'No AI render: our artists draw it from your description'].filter(Boolean).map((t) => `<li>${escapeHtml(t)}</li>`).join('') +
               `</ul></div>${edit('design')}`],
      ['Quantity', `${o.quantity.toLocaleString()} × ${o.size}" ${edit('options')}`],
      o.estimate ? ['Estimate', `${money(o.estimate.total)} (${money(o.estimate.unit)} each)`] : null,
      ['Contact', `${escapeHtml(o.name)}<br>${escapeHtml(o.email)}${o.phone ? '<br>' + escapeHtml(o.phone) : ''}${o.company ? '<br>' + escapeHtml(o.company) : ''} ${edit('details')}`],
      ['Bill to', `${escapeHtml(o.billStreet)}<br>${escapeHtml(o.billCityStateZip)}<br>${escapeHtml(o.billCountry)}`],
      ['Ship to', sameAddr ? 'Same as billing' : `${escapeHtml(o.street)}<br>${escapeHtml(o.cityStateZip)}<br>${escapeHtml(o.country)}`],
      o.notes.trim() ? ['Notes', escapeHtml(o.notes.trim())] : null,
    ].filter(Boolean);
    const table = $('review-table');
    table.innerHTML = rows.map(([k, val]) => `<tr><th>${k}</th><td>${val}</td></tr>`).join('');
    table.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => showStep(b.dataset.edit)));
    if (v) $('review-img').src = v.image;
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
      const v = currentVersion();
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
            aiVersion: v ? v.number : null, renderId: v ? v.renderId : null, aiVersionsMade: ai.nextNumber - 1,
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
    for (const x of $('purposes').children) x.classList.toggle('on', x.dataset.purpose === design.purpose);
    logoDrop.querySelector('.logo-empty').hidden = !!design.logo;
    logoDrop.querySelector('.logo-have').hidden = !design.logo;
    if (design.logo) { $('logo-thumb').src = design.logo; $('logo-name').textContent = design.logoName; }
    for (const b of sizeChips.children) b.classList.toggle('on', b.dataset.size === order.size);
  }

  // ---------- restart ----------
  function restart() {
    Object.assign(design, newDesign());
    Object.assign(order, { quantity: null, size: null, estimate: null, notes: '', name: '', email: '', phone: '', company: '', billStreet: '', billCityStateZip: '', billCountry: 'United States', street: '', cityStateZip: '', country: 'United States' });
    ai.versions = []; ai.current = null; ai.nextNumber = 1;
    $('result').innerHTML = '';
    $('notes').value = ''; $('qty-input').value = '';
    syncControls();
    for (const b of qtyChips.children) b.classList.remove('on');
    $('estimate').hidden = true;
    $('to-details').disabled = true;
    form.reset(); syncShip();
    $('details-error').hidden = true; $('review-error').hidden = true;
    showEmpty();
    renderVersions();
    $('preview-caption').textContent = 'Your AI render appears here.';
    syncDesign();
    showStep('design');
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
  syncDesign();
  showEmpty();
  if (!handleReturnFromCheckout()) showStep('design');
})();
