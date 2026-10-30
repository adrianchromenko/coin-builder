(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // The customer describes both faces of the coin in their own words on one step, and one Generate renders the
  // front and then the back (drawn to match the front). There are no option grids: the server turns the description
  // into the AI prompt, and the artists finish the coin before production. Size and quantity are typed in with the
  // quote; the sizes on offer are the <select> in index.html (keep in step with SIZES in lib/pricing.js), plus
  // "other" with the size in their words.

  const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

  // ---------- state ----------
  const config = { pricing: false, payments: false, testMode: false, provider: '', catalog: null };
  // backMode: 'custom' (its own description, rendered to match the front: nearly every coin), 'same' (the back is the
  //   front again) or 'blank' (plain metal, no design)
  // shape: 'round' or 'odd' (a custom outline: shield, star, state, cut to the artwork; the words say which)
  // shapePicked: they chose the shape themselves, rather than leaving it on round (the Coin Nerd's checklist asks)
  // refs: reference images the customer added besides the logo, as [{ id, name, data (a JPEG data URL), bad? }];
  //   backRefs: the same, for the back alone
  const newDesign = () => ({ front: '', back: '', backMode: 'custom', shape: 'round', shapePicked: false, style: '', logo: null, logoName: '', refs: [], backRefs: [] });
  const design = newDesign();
  // size: one of the sizes in the <select>, or 'other' with the size written in sizeOther
  // finish, color, addons: what the price chart prices (config.catalog lists them). They come from the AI's reading of
  //   the design (analysis); when the design could not be read, the finish is guessed from the style notes and the
  //   finish and color controls appear for the customer to correct (finishPicked, colorPicked)
  // reading: the design is being read right now (the estimate waits for it)
  // quote: the last estimate from the server, { priced, total, lines... } or { priced: false, reason }
  // The one address asked for is the shipping address; it is sent as the billing address too.
  const order = {
    quantity: null, size: null, sizeOther: '', quote: null, notes: '',
    finish: '', finishPicked: false, color: 'two', colorPicked: false, addons: [], analysis: null, reading: false,
    name: '', email: '', phone: '', company: '',
    street: '', cityStateZip: '', country: 'United States',
  };
  // Every AI render is kept as a version, per face: the picture, the proofreading result, and the description it was
  // made from. A back version also remembers which front it was drawn to match, for the record only: any front can be
  // paired with any back, so a customer who likes an earlier front can keep it with a later back.
  const MAX_VERSIONS = 8;
  const newSide = () => ({ versions: [], current: null, nextNumber: 1 });
  const ai = { busy: false, front: newSide(), back: newSide() };
  const sideCurrent = (side) => ai[side].versions.find((v) => v.id === ai[side].current) || null;
  const currentFront = () => sideCurrent('front');
  const currentBack = () => sideCurrent('back');
  const frontRenderId = () => { const f = currentFront(); return f ? f.renderId : null; };
  const frontKey = () => { const f = currentFront(); return f ? f.id : null; }; // which front version a back was drawn for
  const currentVersion = currentFront; // the order, the contact form and checkout are anchored on the front
  let busy = false;
  const customBack = () => design.backMode === 'custom';
  const blankBack = () => design.backMode === 'blank';
  const oddShape = () => design.shape === 'odd';
  const twoSided = () => customBack() && !!design.back.trim();
  // The coin as described has its render: the front, and the back when it has a design of its own
  const rendered = () => !!currentFront() && (!twoSided() || !!currentBack());
  // The pictures a render of the back is shown: its own, or the front's when it has none
  const backRefs = () => (design.backRefs.length ? design.backRefs : design.refs);
  const sideRefs = (side) => (side === 'back' ? backRefs() : design.refs);
  // The deposit Stripe asks for on a quote total, by the server's rule (config.deposit: a flat amount under the
  // threshold, a share of the quote from it up; null when the whole quote is charged). Answers { amount, percent
  // (null when flat) }, or null when there is no deposit or it would cover the quote.
  function depositOf(total) {
    const r = config.deposit;
    if (!r || !(total > 0)) return null;
    const flat = total < r.threshold;
    const amount = Math.min(total, flat ? r.amount : Math.round(total * r.percent) / 100);
    return amount >= total ? null : { amount, percent: flat ? null : r.percent };
  }
  const depositText = (d) => (d.percent ? `${d.percent}% deposit (${money(d.amount)})` : `${money(d.amount)} deposit`);
  // The size in words, for the spec line, the test checkout and the thank-you
  const sizeText = () => (order.size === 'other' ? order.sizeOther.trim() || 'custom size' : order.size ? `${order.size}"` : '');
  // The design as the server records it on renders, orders and leads
  const designPayload = () => ({ shape: design.shape, front: design.front.trim(), back: twoSided() ? design.back.trim() : '', backMode: design.backMode, style: design.style.trim(), logoName: design.logoName, refNames: design.refs.map((r) => r.name), backRefNames: design.backRefs.map((r) => r.name) });

  const configReady = fetch('/api/config').then((r) => r.json()).then((c) => {
    Object.assign(config, c);
    buildOptions();
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
    $('quote-test').hidden = !testState.on;
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

  // ---------- phone studio ----------
  // On a phone the builder is an app-like shell (see "phones: the coin studio" in style.css): the coin stays on screen
  // and the design step is walked through one section at a time (files, front, back, style, shape, then the result),
  // with Back and Next at the bottom. On wider screens every section shows at once and none of this is visible.
  const studio = window.matchMedia('(max-width: 559px), (max-width: 720px) and (orientation: portrait)');
  // id, the name in the row under the coin, the line above the section (first word in script), optional?
  const TABS = {
    design: [
      ['files', 'Files', 'Add', 'your reference files'],
      ['front', 'Front', 'Describe', 'the front'],
      ['back', 'Back', 'Describe', 'the back'],
      ['style', 'Style', 'Pick', 'a style', true],
      ['shape', 'Shape', 'Choose', 'a shape'],
      ['result', 'Result', 'Here’s', 'your coin'],
    ],
  };
  const firstTab = (step) => TABS[step][0][0]; // where the step opens: the reference files
  const tabOpen = { design: firstTab('design') };
  // The sections of the design step. Result is one of them while the coin on screen is the one described.
  function tabsFor(step) {
    const result = TABS[step] && rendered() ? currentFront() : null;
    return { result, tabs: (TABS[step] || []).filter(([id]) => id !== 'result' || result) };
  }
  function renderTabs() {
    const step = $('builder').dataset.step;
    const { result, tabs } = tabsFor(step);
    if (tabs.length && !tabs.some(([id]) => id === tabOpen[step])) tabOpen[step] = firstTab(step);
    const open = tabs.length ? tabOpen[step] : '';
    if ($('builder').dataset.tab !== open) document.querySelector('.panel').scrollTop = 0; // a new section starts at its top
    $('builder').dataset.tab = open;
    const at = tabs.findIndex(([id]) => id === open);
    const inputs = tabs.filter(([id]) => id !== 'result');
    const filled = { files: hasArt(), front: !!design.front.trim(), back: !customBack() || !!design.back.trim(), style: !!design.style.trim(), shape: true };

    // The row under the coin: the sections in order, lit up to the one on show. On Result a dot is the proofreader's verdict.
    const html = tabs.map(([id, label], i) => {
      const verdict = id === 'result' ? coinState().replace('unchecked', '') : '';
      return `<button type="button" class="${i === at ? 'on' : i < at ? 'past' : ''} ${verdict}" data-tab="${id}"${i === at ? ' aria-current="step"' : ''}>${label}${verdict ? '<i></i>' : ''}</button>`;
    }).join('');
    const bar = $('tabs');
    if (bar.dataset.html !== html) { bar.innerHTML = html; bar.dataset.html = html; }
    bar.hidden = tabs.length < 2;
    for (const el of document.querySelectorAll('.panel .step [data-tab]')) el.classList.toggle('tab-off', el.dataset.tab !== tabOpen[el.closest('.step').dataset.step]);

    // The section on show, and the buttons that move through them. One main button at a time: Next (Skip, for an
    // optional section left empty) until the last section, where it is Generate; after a render, the step's own
    // Continue button on Result. Once a design has been rendered and then changed, Generate is offered on every
    // section, so a small edit does not mean walking through them all again.
    const el = step && document.querySelector(`.panel .step[data-step="${step}"]`);
    if (el && TABS[step]) {
      const phone = studio.matches;
      const tab = tabs[at];
      const onResult = open === 'result';
      const editing = !result && ai.front.versions.length > 0;
      const next = phone && !onResult && (result ? true : !editing && open !== inputs[inputs.length - 1][0]);
      const head = el.querySelector('.sub-head');
      const eyebrow = onResult ? versionsLabel() : inputs.length > 1 ? `Step ${at + 1} of ${inputs.length}${tab[4] ? ' · optional' : ''}` : '';
      const headHtml = phone ? `${eyebrow ? `<small>${eyebrow}</small>` : ''}<strong><span class="script">${tab[2]}</span>${tab[3]}</strong>` : '';
      if (head.dataset.html !== headHtml) { head.innerHTML = headHtml; head.dataset.html = headHtml; }
      const subBack = el.querySelector('.sub-back'), subNext = el.querySelector('.sub-next');
      subBack.hidden = !(phone && at > 0);
      subNext.hidden = !next;
      subNext.textContent = tab[4] && !filled[open] ? 'Skip' : 'Next';
      subNext.disabled = !onResult && ['files', 'front', 'back'].includes(open) && !filled[open]; // nothing to render without the pictures and the descriptions
      const off = (node, on) => { if (node) node.classList.toggle('sub-off', on); };
      off(el.querySelector('#to-quote'), phone && !!result && !onResult);
      off(el.querySelector('#generate-btn'), next);
      off(el.querySelector('#design-hint'), next); // it talks about Generate and Continue, which are not on this screen
    }
    // The proofreading result and the offer to fix the design: in the Result tab on a phone, under the coin otherwise
    const slot = studio.matches ? document.querySelector('.panel .step[data-step="design"] .result-slot') : null;
    const home = slot || document.querySelector('.preview');
    if ($('ai-check').parentElement !== home) home.append($('ai-check'), $('ai-disclaimer'));
    nerdPlace();
  }
  function openTab(id) {
    const step = $('builder').dataset.step;
    if (!TABS[step]) return;
    tabOpen[step] = id;
    renderTabs();
  }
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) openTab(b.dataset.tab); });
  // Back and Next: one section of the step back or on
  document.querySelector('.panel').addEventListener('click', (e) => {
    const b = e.target.closest('.sub-back, .sub-next');
    if (!b) return;
    const step = $('builder').dataset.step;
    const ids = tabsFor(step).tabs.map(([id]) => id);
    const to = ids[ids.indexOf(tabOpen[step]) + (b.classList.contains('sub-next') ? 1 : -1)];
    if (to) openTab(to);
  });
  studio.addEventListener('change', renderTabs);

  // The on-screen keyboard: the page does nothing about it. The phone slides the page up by itself to show the field
  // being typed in, in step with the keyboard, and slides it back afterwards. Everything this page used to add on top
  // (fitting the shell to the space above the keyboard, hiding the coin, nudging the field into view) was a second
  // movement after the phone's own, and that second movement is what looked glitchy. A screen too short for the coin
  // (a phone held sideways, or a browser that shrinks the page for the keyboard) is handled in style.css alone.
  // One leftover is tidied here: some iPhones leave the page slid up after the keyboard has gone. If it is still off
  // its place a moment after typing ends, it is put back.
  const typedIn = (el) => !!el && el.matches && el.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]):not([type="button"]):not([type="submit"])');
  document.addEventListener('focusout', (e) => {
    if (!studio.matches || !typedIn(e.target)) return;
    setTimeout(() => {
      if (typedIn(document.activeElement)) return; // on to the next field: the keyboard stays up
      const vv = window.visualViewport;
      if ((vv && vv.offsetTop > 1) || window.scrollY > 1) window.scrollTo(0, 0);
    }, 450);
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
    design.shapePicked = true;
    syncShape();
    syncDesign();
  });
  function syncShape() {
    for (const x of $('coin-shape').children) x.classList.toggle('on', x.dataset.shape === design.shape);
    $('shape-hint').textContent = oddShape()
      ? 'Say what shape in your description or style notes: a shield, a star, your state, or cut to your logo. Left unsaid, we cut it to your artwork.'
      : 'Round is the classic challenge coin.';
    // An odd-shaped coin has no diameter: its size is the longest side, which is what it is priced by (asked for with the quote)
    $('size-measure').textContent = oddShape() ? 'longest side' : 'diameter';
    $('size-hint').textContent = oddShape()
      ? 'Measure the longest side of the shape. Most coins are 1.75" or 2" across. Choose "Other" for a size that is not listed.'
      : 'Most challenge coins are 1.75" or 2". Choose "Other" for a size that is not listed.';
  }

  // Size: picked from the list on the quote step, or "Other" with the size written in
  const sizeSelect = $('size-select');
  const sizeOtherInput = $('size-other');
  sizeSelect.addEventListener('change', () => { setSize(sizeSelect.value); if (order.size === 'other') sizeOtherInput.focus(); });
  sizeOtherInput.addEventListener('input', (e) => { order.sizeOther = e.target.value; e.target.classList.remove('bad'); syncDesign(); updateEstimate(); });
  function setSize(s) {
    order.size = s || null;
    sizeSelect.classList.remove('bad');
    $('size-other-field').hidden = order.size !== 'other';
    syncDesign();
    updateEstimate();
  }

  // A coin cannot be generated from words alone: it needs the logo or at least one reference image as well, the front
  // described, and the back described too when it has a design of its own
  const hasArt = () => !!design.logo || design.refs.length > 0;
  const designReady = () => !!design.front.trim() && hasArt() && (!customBack() || !!design.back.trim());
  function specLine() {
    const refs = design.refs.length + design.backRefs.length;
    const back = customBack() ? (design.back.trim() ? 'Front & back' : '') : blankBack() ? 'Blank back' : 'Same both sides';
    return [sizeText(), oddShape() ? 'Odd shaped' : '', back, design.logoName ? 'Your logo' : '', refs ? `${refs} reference${refs > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
  }
  // What a render of each face depends on. A back render is also tied to the front render it was matched against.
  const logoKey = () => (design.logo ? design.logo.length : 0);
  const refsKey = (list) => list.map((r) => r.id).join();
  const frontSignature = () => JSON.stringify({ shape: design.shape, front: design.front.trim(), style: design.style.trim(), logoName: design.logoName, logo: logoKey(), refs: refsKey(design.refs) });
  const backSignature = () => JSON.stringify({ shape: design.shape, back: design.back.trim(), style: design.style.trim(), logoName: design.logoName, logo: logoKey(), refs: refsKey(backRefs()) });
  const sideSignature = (side) => (side === 'back' ? backSignature() : frontSignature());

  // A design change means the render on screen no longer matches; earlier versions stay in the strip.
  // The step's footer offers exactly one next move: generate the coin (or just the back, when the front is done and
  // the back is not), or go on to the quote.
  function syncDesign() {
    $('preview-spec').textContent = specLine();
    for (const side of ['front', 'back']) {
      const v = sideCurrent(side);
      if (v && v.signature !== sideSignature(side)) ai[side].current = null;
      // Back to a description that was rendered before: that version comes back on its own
      if (!sideCurrent(side)) { const again = [...ai[side].versions].reverse().find((x) => x.signature === sideSignature(side) && !x.expired); if (again) ai[side].current = again.id; }
    }
    const front = currentFront();
    const back = currentBack();
    const backText = design.back.trim();

    // The back: its own description, or a word that it is the front again or plain metal
    $('back-custom').hidden = !customBack();
    for (const b of $('back-mode').children) b.classList.toggle('on', b.dataset.mode === design.backMode);
    const modeHint = $('back-mode-hint');
    modeHint.hidden = customBack();
    modeHint.textContent = blankBack() ? 'The back will be plain metal with no design.' : 'The back will carry the same design as the front.';

    const done = rendered();
    const btn = $('generate-btn');
    btn.hidden = done;
    btn.disabled = !designReady() || ai.busy;
    btn.textContent = front && twoSided() && !back ? 'Generate the Back' : 'Generate This Coin';
    $('to-quote').hidden = !done;
    $('design-hint').textContent = !hasArt()
      ? (design.front.trim() ? 'Add your logo or a reference image to go on. We need at least one before we can draw your coin.' : 'Start with your reference files, then describe the front and the back of your coin.')
      : !design.front.trim()
        ? 'Describe the front of your coin: what goes on it, and where.'
        : customBack() && !backText
          ? 'Describe the back: what goes on it, and where. Or choose "Same as the front" or "Blank".'
          : done
            ? 'Happy with it? Continue to your quote. Not quite? Change a description or make another version.'
            : front && twoSided()
              ? (ai.back.versions.length ? 'The back changed. Tap "Generate the Back" to render it again to match your front.' : 'Tap "Generate the Back" to see it rendered to match your front.')
              : ai.front.versions.length
                ? 'The design changed. Tap "Generate This Coin" to render it again.'
                : `Looking good. Tap "Generate This Coin" to see ${twoSided() ? 'both sides' : 'it'} rendered.`;
    renderPreview();
    renderVersions();
    renderRefs();
    renderTabs();
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
    reader.onload = () => setLogoData(reader.result, file.name);
    reader.readAsDataURL(file);
  }
  // The logo as a data URL: from a file, or fetched from a link
  async function setLogoData(dataUrl, name) {
    design.logo = await prepareLogo(dataUrl);
    design.logoName = name;
    logoDrop.classList.remove('bad');
    $('logo-thumb').src = design.logo;
    $('logo-name').textContent = name;
    logoDrop.querySelector('.logo-empty').hidden = true;
    logoDrop.querySelector('.logo-have').hidden = false;
    syncDesign();
  }
  // "Or paste a link": the server fetches the picture at the address, or finds the logo on the page there
  const logoUrl = $('logo-url');
  const logoFetch = $('logo-fetch');
  async function fetchLogo() {
    const url = logoUrl.value.trim();
    if (!url) { toast('Paste a link to your website, or to a picture, first.'); logoUrl.focus(); return; }
    if (logoFetch.disabled) return;
    logoFetch.disabled = true;
    logoFetch.innerHTML = 'Looking… <span class="typing"><i></i><i></i><i></i></span>';
    logoUrl.classList.remove('bad');
    try {
      const res = await fetch('/api/fetch-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'We could not fetch that link.');
      await setLogoData(data.image, data.name || url);
      logoUrl.value = '';
      toast(data.fromPage ? 'Found a logo on that page. Not the right picture? Remove it and upload the file instead.' : 'Got it: that picture is your logo now.', 4500);
    } catch (e) {
      logoUrl.classList.add('bad');
      toast(escapeHtml(e.message || 'We could not fetch that link.'), 5000);
    } finally {
      logoFetch.disabled = false;
      logoFetch.textContent = 'Grab Logo';
    }
  }
  logoFetch.addEventListener('click', fetchLogo);
  logoUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fetchLogo(); } });
  logoUrl.addEventListener('input', () => logoUrl.classList.remove('bad'));
  function clearLogo() {
    design.logo = null; design.logoName = '';
    logoDrop.classList.remove('bad');
    logoDrop.querySelector('.logo-empty').hidden = false;
    logoDrop.querySelector('.logo-have').hidden = true;
    syncDesign();
  }
  logoDrop.addEventListener('click', (e) => { if (!e.target.closest('#logo-remove')) logoFile.click(); });
  logoDrop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); logoFile.click(); } });
  logoFile.addEventListener('change', () => { setLogo(logoFile.files && logoFile.files[0]); logoFile.value = ''; });
  $('logo-remove').addEventListener('click', (e) => { e.stopPropagation(); clearLogo(); });

  // ---------- reference images ----------
  // Besides the logo, pictures that show what the customer has in mind: photos, sketches, examples. They go to the AI
  // with every render, and the description says how to use them. The image model takes only so many input images,
  // hence the limit.
  const MAX_REFS = 8; // keep in step with MAX_OWN_REFS in server.js
  let refSeq = 0;
  const readFile = (file) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => resolve(null); r.readAsDataURL(file); });
  // A phone photo is far larger than the AI needs: scale it down and keep it as a JPEG
  function prepareReference(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        try {
          const scale = Math.min(1, 1400 / Math.max(img.naturalWidth || 1400, img.naturalHeight || 1400));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round((img.naturalWidth || 1400) * scale));
          c.height = Math.max(1, Math.round((img.naturalHeight || 1400) * scale));
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // a see-through background would come out black in a JPEG
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.86));
        } catch (_) { resolve(null); }
      };
      img.src = dataUrl;
    });
  }
  // side: 'front' or 'back', the face the pictures are for
  const ownRefs = (side) => (side === 'back' ? design.backRefs : design.refs);
  async function addRefs(side, files) {
    const list = ownRefs(side);
    let skipped = 0, full = false;
    for (const file of files) {
      if (list.length >= MAX_REFS) { full = true; break; }
      if (!/^image\/(png|jpe?g|webp)$/i.test(file.type) || file.size > 20 * 1024 * 1024) { skipped++; continue; }
      const raw = await readFile(file);
      const data = raw && await prepareReference(raw);
      if (!data) { skipped++; continue; }
      if (list.length >= MAX_REFS) { full = true; break; }
      list.push({ id: 'r' + (++refSeq), name: file.name, data });
    }
    if (full) toast(`You can add up to ${MAX_REFS} reference images.`);
    else if (skipped) toast('Reference images need to be PNG, JPG or WEBP pictures under 20 MB.');
    syncDesign();
  }
  // The three places pictures are shown and added: the front's, the back's, and the "Make Another Version" popup,
  // which shows the pictures of the face being redrawn
  let reviseSide = 'both'; // which side "Make Another Version" redraws: 'front', 'back' or 'both' (see openRevise)
  const REF_BOXES = [['refs', 'ref-add', 'ref-files', () => 'front'], ['back-refs', 'back-ref-add', 'back-ref-files', () => 'back'], ['revise-refs', 'revise-ref-add', 'revise-ref-files', () => (reviseSide === 'back' ? 'back' : 'front')]];
  function renderRefs() {
    for (const [boxId, addId, , sideOf] of REF_BOXES) {
      const box = $(boxId), side = sideOf(), list = ownRefs(side);
      const key = side + ':' + list.map((r) => r.id + (r.bad ? '!' : '')).join();
      if (box.dataset.key !== key) {
        box.dataset.key = key;
        for (const n of box.querySelectorAll('.ref')) n.remove();
        $(addId).insertAdjacentHTML('beforebegin', list.map((r) => {
          const name = escapeHtml(r.name);
          return `<div class="ref${r.bad ? ' bad' : ''}" title="${name}${r.bad ? ' (we cannot use this one)' : ''}"><img src="${r.data}" alt="${name}"><button type="button" class="ref-remove" data-ref="${r.id}" data-side="${side}" aria-label="Remove ${name}">&times;</button></div>`;
        }).join(''));
      }
      $(addId).hidden = list.length >= MAX_REFS;
    }
  }
  for (const [boxId, addId, filesId, sideOf] of REF_BOXES) {
    $(addId).addEventListener('click', () => $(filesId).click());
    $(filesId).addEventListener('change', (e) => { addRefs(sideOf(), [...e.target.files]); e.target.value = ''; });
    $(boxId).addEventListener('click', (e) => {
      const b = e.target.closest('[data-ref]');
      if (!b) return;
      if (b.dataset.side === 'back') design.backRefs = design.backRefs.filter((r) => r.id !== b.dataset.ref);
      else design.refs = design.refs.filter((r) => r.id !== b.dataset.ref);
      syncDesign();
    });
  }
  // The server screens every upload before it reaches the AI; one it will not use is marked, so the customer can see
  // which to take out
  function markRejected(snapshot, rejected) {
    for (const i of rejected.refs || []) if (snapshot.refs[i]) snapshot.refs[i].bad = true;
    logoDrop.classList.toggle('bad', !!rejected.logo);
  }

  // Page-wide drag & drop and paste for the logo and the reference images
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0; $('drop').hidden = true;
    const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
    if (!files.length) return;
    // Dropped on the reference images (the front's or the back's), they all go there. Anywhere else the first one
    // is the logo, and any others that came with it are references for the front.
    const under = document.elementsFromPoint(e.clientX, e.clientY);
    if (under.some((el) => el.id === 'back-ref-field')) { addRefs('back', files); return; }
    if (under.some((el) => el.id === 'ref-field')) addRefs('front', files);
    else { setLogo(files[0]); if (files.length > 1) addRefs('front', files.slice(1)); }
    tabOpen.design = 'files';
    showStep('design');
  });
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) { setLogo(it.getAsFile()); tabOpen.design = 'files'; showStep('design'); break; }
    }
  });

  // ---------- the turning coins ----------
  // Two gold coins are built from the same parts: the waiting coin on the empty preview and the loading coin that
  // turns while a render is made. They are house coins and plainly not the customer's: the Coin Nerd on the front, the
  // company logo on the back. (They used to carry the customer's own logo, which read as a promise of what their coin
  // would look like.) Each is two faces with a stack of discs between them for its thickness.
  // id: a prefix that keeps the gradients of one coin apart from the other's. motto: the line along the foot of the front.
  function coinFaces(id, motto) {
    const arc = (where, text) => `<text><textPath href="#${id}-${where}" startOffset="50%">${text}</textPath></text>`;
    // the metal: a reeded edge, a raised rim lit from the top left, a field that dips toward the rim, and a ring of beads
    const disc = `<circle cx="100" cy="100" r="100" fill="url(#${id}-gold)"/><circle class="mint-reeds" cx="100" cy="100" r="97.2"/>` +
      `<circle cx="100" cy="100" r="92.6" fill="none" stroke="url(#${id}-rim)" stroke-width="3.2"/><circle cx="100" cy="100" r="91" fill="url(#${id}-well)"/>` +
      '<circle class="mint-beads" cx="100" cy="100" r="87.4"/>';
    return `<span class="mint-face mint-front"><svg viewBox="0 0 200 200">
        <defs>
          <radialGradient id="${id}-gold" cx="34%" cy="28%" r="85%"><stop offset="0" stop-color="#FFF3B0"/><stop offset=".32" stop-color="#EBC24A"/><stop offset=".72" stop-color="#BA871B"/><stop offset="1" stop-color="#7A5510"/></radialGradient>
          <linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF8D2"/><stop offset=".45" stop-color="#D9A93A"/><stop offset="1" stop-color="#5E3F08"/></linearGradient>
          <radialGradient id="${id}-well"><stop offset=".7" stop-color="#3C2604" stop-opacity="0"/><stop offset="1" stop-color="#3C2604" stop-opacity=".3"/></radialGradient>
          <path id="${id}-top" d="M 30 100 A 70 70 0 0 1 170 100"/><path id="${id}-bottom" d="M 17 100 A 83 83 0 0 0 183 100"/>
          <clipPath id="${id}-cameo"><circle cx="100" cy="101" r="43"/></clipPath>
        </defs>
        ${disc}${arc('top', 'COINS FOR ANYTHING')}${arc('bottom', motto)}
        <circle class="mint-cameo-shade" cx="100" cy="102.5" r="47.5"/><circle class="mint-cameo" cx="100" cy="101" r="45" stroke="url(#${id}-rim)"/>
        <image href="brand/coinnerd-coin.webp" x="55" y="56" width="90" height="90" clip-path="url(#${id}-cameo)"/>
        <circle class="mint-cameo-ring" cx="100" cy="101" r="43"/>
      </svg></span>
      <span class="mint-face mint-back"><svg viewBox="0 0 200 200">${disc}${arc('top', '★ EST. 2002 ★')}${arc('bottom', '★ VETERAN OWNED ★')}<image href="brand/logo-coin.webp" x="17" y="64.7" width="166" height="72.5"/></svg></span>` +
      Array.from({ length: 13 }, (_, z) => `<i class="mint-edge" style="--z:${z - 6}"></i>`).join('');
  }
  const sparks = (list) => list.map(([x, y, d]) => `<i class="mint-spark" style="--x:${x}%;--y:${y}%;--d:${d}s"></i>`).join('');

  // The waiting coin: until there is a render it hangs on the empty face (see "the waiting coin" in style.css)
  document.querySelectorAll('.coin-mark').forEach((el, k) => {
    el.innerHTML = `<span class="coin-float"><span class="coin-turn">${coinFaces('idle' + k, '★ YOUR COIN HERE ★')}</span></span>${sparks([[0, 10, 0], [96, 16, 1.3], [90, 88, .6], [4, 80, 2]])}`;
  });

  // ---------- the render on screen ----------
  // The waiting coin until the first render starts. From then on both faces side by side: the front on the left and,
  // on the right, the back render, or the front again (dimmed) when the back is "same as the front".
  function renderPreview() {
    const front = currentFront();
    const back = currentBack();
    const two = ai.front.versions.length > 0 || ai.busy;
    $('stage').classList.toggle('two', two);
    // Nothing to show and nothing on its way: small screens shrink the stage to a short banner
    $('stage').classList.toggle('empty', !two);
    document.querySelector('.preview').classList.toggle('two', two);
    const setFace = (face, v, { same = false, hint = '' } = {}) => {
      const el = $('face-' + face);
      const img = el.querySelector('img');
      el.classList.toggle('same', same);
      // only what changed is touched: this runs on every keystroke, and a picture set again is a picture drawn again
      if (v) { if (img.getAttribute('src') !== v.image) img.src = v.image; img.hidden = false; img.alt = `${face === 'front' ? 'Front' : 'Back'} of your coin, AI version ${v.number}`; }
      else if (!img.hidden) { img.hidden = true; img.removeAttribute('src'); img.alt = ''; }
      el.querySelector('.face-empty').hidden = !!v;
      const p = el.querySelector('.face-empty p');
      if (p.dataset.html !== hint) { p.innerHTML = hint; p.dataset.html = hint; }
      el.querySelector('.face-label').textContent = face === 'front' ? 'Front' : same ? 'Back · same as front' : blankBack() ? 'Back · blank' : 'Back';
      el.querySelector('.face-label').hidden = !two;
    };
    setFace('front', front, { hint: !two ? 'Add a reference file, describe the front and the back, then tap <b>Generate This Coin</b>. Both sides show up here in a few minutes.' : 'The design changed. Tap <b>Generate This Coin</b> to render it again.' });
    $('face-back').hidden = !two;
    if (two) {
      if (blankBack()) setFace('back', null, { hint: 'The back is plain metal, with no design.' });
      else if (!customBack()) setFace('back', front, { same: true, hint: 'The back matches the front.' });
      else setFace('back', back, { hint: ai.busy ? 'The back comes next, drawn to match the front.' : front ? 'Tap <b>Generate the Back</b> to draw it to match your front.' : 'The back is drawn to match the front.' });
    }
    $('preview-caption').textContent = front
      ? (front.demo
        ? (isTest() ? 'Test mode: a stand-in for the AI render.' : 'Demo render (add an API key on the server for real AI renders).')
        : `${versionsLabel()}, shown with a light preview watermark. The artwork made for your order is clean and full quality.`)
      : 'Your AI render appears here.';
  }
  // "Front version 2, back version 1": the renders on screen
  function versionsLabel() {
    const f = currentFront(), b = twoSided() ? currentBack() : null;
    return f ? `Front version ${f.number}${b ? `, back version ${b.number}` : ''}` : '';
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
    // text: what the Coin Nerd says in his speech bubble under the turning coin
    starting: { from: 2, to: 8, seconds: 4, text: 'On it! Sending your design over…' },
    rendering: { from: 8, to: 55, seconds: 45, text: 'Striking your coin. This is the fun part!' },
    checking: { from: 55, to: 75, seconds: 15, text: 'Hang on, I’m proofreading every letter…' },
    retrying: { from: 60, to: 88, seconds: 45, text: 'Hmm, I spotted a typo. Having it drawn again!' },
    finishing: { from: 90, to: 97, seconds: 6, text: 'Giving it a quick polish…' },
    done: { from: 100, to: 100, seconds: 1, text: 'Ta-da! Here it is!' },
  };
  // base and scale: this face's share of the ring, when one Generate draws the front and then the back (the front fills
  // the first half, the back the second); face: the side being drawn, for the Coin Nerd's lines
  const progress = { sides: new Map(), overall: null, timer: null, source: null, started: 0, line: -1, lines: [], base: 0, scale: 1, face: 'front' };
  // Something to read under the turning coin; the line changes every few seconds. First how long it takes, then fun
  // facts about Coins For Anything with a tip between them now and then. The facts come in a new order for each
  // render, since most customers sit through several. Each fits on two lines of a phone, so keep new ones under about
  // 80 characters. (The figures match the line at the foot of the page.)
  const WAIT_FIRST = 'Usually takes one to two minutes.';
  const WAIT_FIRST_TWO = 'Usually takes three to four minutes for both sides.';
  const WAIT_FACTS = [
    'We have minted over 20 million coins across more than 60,000 designs.',
    'More than 50,000 companies, units and organizations trust us with their coins.',
    'Every coin is 3.5mm thick: 0.5mm over the industry standard, free of charge.',
    'A thicker coin has more weight in the hand and room for deeper 3D relief.',
    'We have been making custom coins since November 2002.',
    'It all started with a Marine at Camp Lejeune: our founder, Jeff Morin.',
    'Our very first custom coin was made for the mother of a Marine.',
    'We invented Die Mold Insurance, which keeps your coin’s mold on file forever.',
    'Coins do not have to be round: we make squares, ovals, hexagons and cut-outs.',
    'Some of our coins double as bottle openers.',
    'We mint for the military, police, fire departments, companies and nonprofits.',
    'Our artists redraw every coin by hand before it is minted.',
    'Tradition says: caught without your coin, you buy the round.',
  ];
  const WAIT_TIPS = [
    'Not quite right? You can make another version afterwards.',
    'Wording in "double quotes" is read back letter by letter.',
  ];
  function waitLines(faces) {
    const facts = WAIT_FACTS.map((text) => ['Fun fact:', text]);
    for (let i = facts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [facts[i], facts[j]] = [facts[j], facts[i]]; }
    WAIT_TIPS.forEach((text, i) => facts.splice(3 + i * 5, 0, ['', text]));
    return [['', faces > 1 ? WAIT_FIRST_TWO : WAIT_FIRST], ...facts];
  }
  // The loading coin (see "the mint" in style.css): the same house coin, turning inside the ring, with sparks around it
  document.querySelector('.mint-coin').innerHTML = coinFaces('mint', '★ IN THE MAKING ★');
  $('mint').insertAdjacentHTML('beforeend', sparks([[6, 16, 0], [88, 8, .9], [98, 56, 1.7], [80, 90, .4], [12, 84, 1.3], [-2, 46, 2.1], [48, -5, 2.4]]));
  // faces: how many renders this Generate makes (one, or the front and then the back)
  function progressStart(faces) {
    progress.started = Date.now(); progress.line = -1; progress.lines = waitLines(faces);
    progress.base = 0; progress.scale = 1 / faces;
    clearInterval(progress.timer);
    progress.timer = setInterval(progressTick, 250);
  }
  // On to one face's render: its share of the ring starts where the one before left off
  function progressFace(face, i, faces) {
    progress.sides.clear(); progress.overall = null;
    progress.face = face; progress.base = (100 * i) / faces; progress.scale = 1 / faces;
    progressSet('starting');
    progressTick();
  }
  function progressSet(stage, side) {
    const s = STAGES[stage] || STAGES.starting;
    const entry = { stage, from: s.from, to: s.to, seconds: s.seconds, started: Date.now() };
    if (side) progress.sides.set(side, entry); else progress.overall = entry;
    const says = progress.face === 'back' && stage === 'starting' ? 'Front done! Now for the back…'
      : progress.face === 'back' && stage === 'rendering' ? 'Striking the back to match your front…' : s.text;
    const bubble = $('progress-text');
    if (bubble.textContent !== says) {
      bubble.textContent = says;
      bubble.style.animation = 'none'; void bubble.offsetWidth; bubble.style.animation = ''; // the bubble pops again for a new line
    }
    $('preview-busy').dataset.stage = stage; // the loading coin moves differently at each stage
  }
  const stagePct = (e) => e.from + (e.to - e.from) * (1 - Math.exp(-((Date.now() - e.started) / 1000) / (e.seconds / 2)));
  function progressTick() {
    // Once the sides report in, they carry the bar; before that (and at the end) the overall stage does
    const entries = progress.overall && ['finishing', 'done'].includes(progress.overall.stage) ? [progress.overall] : progress.sides.size ? [...progress.sides.values()] : [progress.overall];
    const pct = Math.round(progress.base + (entries.reduce((n, e) => n + stagePct(e), 0) / entries.length) * progress.scale);
    $('mint-ring-bar').style.strokeDashoffset = 100 - pct;
    $('mint').setAttribute('aria-valuenow', pct);
    const line = Math.floor((Date.now() - progress.started) / 6500) % progress.lines.length;
    if (line !== progress.line) {
      progress.line = line;
      const sub = $('progress-sub');
      const [label, text] = progress.lines[line];
      sub.textContent = text;
      if (label) { const b = document.createElement('strong'); b.textContent = label + ' '; sub.prepend(b); }
      sub.style.animation = 'none'; void sub.offsetWidth; sub.style.animation = ''; // play its fade-in again
    }
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

  // On a phone the coin sits above the form, so Generate is tapped with the coin off screen: bring it back into view
  // for the progress bar and the render. On a wide screen the coin is pinned beside the form and nothing moves.
  function revealStage() {
    const r = $('stage').getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // One Generate draws the whole coin: the front, then the back to match it (when the back has a design of its own).
  // sides: the faces to draw, in order; notes: what the customer wants different on each, from the "Make Another
  // Version" popup (optional). A face that is already drawn for this design is drawn again only when asked for.
  async function generateCoin(sides, notes = {}) {
    if (ai.busy) return;
    if (!designReady()) {
      toast(!hasArt() ? 'Add your logo or a reference image first.' : !design.front.trim() ? 'Describe the front of your coin first.' : 'Describe the back first, or choose "Same as the front" or "Blank".');
      return;
    }
    const faces = sides.filter((s) => s === 'front' || twoSided());
    if (!faces.length) return;
    ai.busy = true;
    guideStop(); // the Coin Nerd's walk-through ends where the render begins
    const genBtn = $('generate-btn');
    const genLabel = genBtn.textContent;
    $('ai-btn').disabled = true;
    genBtn.disabled = true;
    genBtn.textContent = 'Generating…';
    $('preview-busy').hidden = false;
    progressStart(faces.length);
    revealStage();
    try {
      for (const [i, side] of faces.entries()) {
        $('preview-busy').dataset.face = side; // the wait sits over the face being drawn; the other shows what there is
        progressFace(side, i, faces.length);
        renderPreview();
        if (!(await renderSide(side, notes[side]))) break; // the toast has said why
      }
      if (rendered()) tabOpen.design = 'result'; // on a phone: straight to what the proofreader found
    } finally {
      progressEnd();
      ai.busy = false;
      $('ai-btn').disabled = false;
      genBtn.textContent = genLabel;
      $('preview-busy').hidden = true;
      syncDesign(); // the step's footer now offers the next move
    }
  }
  // Generate: the whole coin, or just the back when the front on screen is the one described
  $('generate-btn').addEventListener('click', () => generateCoin(currentFront() ? ['back'] : ['front', 'back']));

  // One face. The back is drawn with the front on screen as its reference. Returns the new version, or null when the
  // render failed (a toast says why). note: what the customer wants different in this version (optional).
  async function renderSide(side, note = '') {
    note = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    // refs: the pictures this render is shown (the back's own, or the front's when it has none)
    const snapshot = { ...designPayload(), logo: design.logo, refs: sideRefs(side).slice(), backRefs: design.backRefs.slice() };
    const text = side === 'back' ? snapshot.back : snapshot.front;
    const signature = sideSignature(side);
    const anchor = frontRenderId(); // the front this back is drawn to match
    const anchorKey = frontKey();
    // A change they asked for is made to the version on screen, so that picture goes along. Without it the AI was only
    // ever shown the front, and a change asked of the back came out as the front again.
    const shown = sideCurrent(side);
    const base = note && shown && shown.renderId ? shown.renderId : '';
    // Another version of a face already rendered: tell the server not to hand back the cached one
    const fresh = ai[side].versions.some((v) => v.signature === signature);
    try {
      let data;
      if (isTest()) {
        // long enough to see the loading coin through each of its stages
        for (const [stage, ms] of [['rendering', 2600], ['checking', 2200], ['finishing', 1200]]) { progressSet(stage); progressTick(); await sleep(ms); }
        data = { image: testRenderSvg(text, side.toUpperCase(), snapshot.shape === 'odd'), renderId: 'test-' + side + '-' + ai[side].nextNumber, check: null, provider: 'test' };
      } else {
        const token = await turnstileToken();
        const progressId = (Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-z0-9]/g, '');
        if (progress.source) progress.source.close(); // the front's stream, when this is the back
        progress.source = progressListen(progressId);
        const form = new FormData();
        if (snapshot.logo) form.append('logo', await (await fetch(snapshot.logo)).blob(), 'logo.png');
        for (const [i, r] of snapshot.refs.entries()) form.append('refs', await (await fetch(r.data)).blob(), `reference-${i + 1}.jpg`);
        form.append('side', side);
        form.append('description', text);
        if (note) form.append('note', note);
        if (base) form.append('baseRenderId', base);
        form.append('shape', snapshot.shape);
        form.append('style', snapshot.style);
        if (side === 'back') form.append('frontRenderId', anchor || '');
        form.append('progressId', progressId);
        if (fresh) form.append('fresh', '1');
        if (token) form.append('turnstile', token);
        const res = await fetch('/api/generate', { method: 'POST', body: form });
        data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.rejected) markRejected(snapshot, data.rejected);
          // The version the change was asked of is gone from the server (clean renders are kept a few days): it comes
          // off the stage, and the step offers to draw that face again
          if (data.expired && shown) { shown.expired = true; ai[side].current = null; }
          throw new Error(data.error || 'Render failed');
        }
      }
      progressSet('done'); progressTick();
      await sleep(700); // the loading coin lands with a flash before the render replaces it
      const s = ai[side];
      const version = { id: side + s.nextNumber, number: s.nextNumber++, image: data.image, renderId: data.renderId || null, check: data.check || null, demo: data.provider === 'demo' || data.provider === 'test', design: snapshot, signature, note, frontRenderId: side === 'back' ? anchor : null, frontKey: side === 'back' ? anchorKey : null };
      s.versions.push(version);
      // Keep the strip (and the browser's memory) bounded: drop the oldest version that is not on screen
      while (s.versions.length > MAX_VERSIONS) s.versions.splice(s.versions.findIndex((v) => v.id !== s.current), 1);
      // If the description was edited while this was rendering, keep the version but do not show it as current
      if (signature === sideSignature(side)) s.current = version.id;
      else toast(`${side === 'back' ? 'Back' : 'Front'} version ${version.number} is ready. Tap it under the coin to see it.`, 5000);
      syncDesign(); // the face lands on the stage before the next one starts
      return version;
    } catch (e) {
      toast(escapeHtml(e.message || 'Sorry, the AI render failed. Please try again.'), 5000);
      return null;
    }
  }

  // Show a version. If it was made from a different description, that description comes back with it,
  // so the picture, the form, and the order always describe the same coin.
  function showVersion(side, id) {
    const s = ai[side];
    const v = s.versions.find((x) => x.id === id);
    if (!v) return;
    if (v.expired) {
      toast(`That ${side} has expired on our side (renders are kept for a few days). Generate the ${side} again to go on from it.`, 6000);
      return;
    }
    if (v.signature !== sideSignature(side)) {
      const d = v.design;
      if (side === 'front') Object.assign(design, { shape: d.shape || 'round', front: d.front, style: d.style, logo: d.logo, logoName: d.logoName, refs: (d.refs || []).slice() });
      else Object.assign(design, { back: d.back, backMode: 'custom', backRefs: (d.backRefs || []).slice() });
      syncControls();
    }
    s.current = id;
    syncDesign();
  }

  function removeVersion(side, id) {
    const s = ai[side];
    s.versions = s.versions.filter((v) => v.id !== id);
    if (s.current === id) s.current = null;
    syncDesign(); // without a render on screen, the next step has to wait for a new one
  }

  const checkState = (v) => (!v.check || !v.check.checked ? 'unchecked' : v.check.ok ? 'ok' : 'warn');
  // The faces on screen that have a render of their own: [side, version]
  const shownFaces = () => [['front', currentFront()], ['back', customBack() ? currentBack() : null]].filter(([, v]) => v);
  // The proofreader's verdict on the coin as a whole: a warning on either face is a warning
  function coinState() {
    const states = shownFaces().map(([, v]) => checkState(v));
    return states.includes('warn') ? 'warn' : states.includes('ok') ? 'ok' : 'unchecked';
  }

  // The strip under the coin: the front's versions, then the back's. The first render starts from the step's button;
  // "Make Another Version" takes over from there.
  let versionsHtml = '';
  function renderVersions() {
    const any = ai.front.versions.length > 0;
    $('versions-wrap').hidden = !any;
    $('ai-btn').hidden = !any;
    const strip = (side) => ai[side].versions.map((v) => {
      const state = checkState(v);
      const stale = !!v.expired;
      const label = `${side === 'back' ? 'Back' : 'Front'} version ${v.number}` + (stale ? ', expired' : state === 'ok' ? ', wording checked' : state === 'warn' ? ', needs a look' : '') + (v.note ? `. Asked for: ${v.note}` : '');
      return `<button type="button" class="version${v.id === ai[side].current ? ' on' : ''} ${state}${stale ? ' stale' : ''}" data-version="${v.id}" data-side="${side}" aria-pressed="${v.id === ai[side].current}" aria-label="${label}" title="${label}">` +
        `<img src="${v.image}" alt=""><span class="num">${side === 'back' ? 'B' : 'F'}${v.number}</span>${state === 'unchecked' || stale ? '' : `<span class="flag" aria-hidden="true">${state === 'ok' ? '✓' : '!'}</span>`}</button>`;
    }).join('');
    const backs = customBack() ? strip('back') : '';
    const html = strip('front') + (backs ? `<i class="versions-split" aria-hidden="true"></i>${backs}` : '');
    if (html !== versionsHtml) { $('versions').innerHTML = html; versionsHtml = html; } // rebuilt only when it changes, not on every keystroke
    renderCheck();
  }
  $('versions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-version]');
    if (b) showVersion(b.dataset.side, b.dataset.version);
  });

  // The proofreading result for each face on screen, in plain words, plus the standing offer to fix it by hand
  function renderCheck() {
    const box = $('ai-check');
    const faces = shownFaces();
    $('ai-disclaimer').hidden = !faces.length;
    if (!faces.length) { box.hidden = true; return; }
    const parts = faces.map(([side, v]) => {
      const name = side === 'back' ? 'Back' : 'Front';
      const state = checkState(v);
      const c = v.check || {};
      let html = `<strong>${name} version ${v.number}.</strong>`;
      if (state === 'ok') {
        html = `<strong>✓ ${name}: wording checked.</strong><span class="more"> We read it back letter by letter and every quoted word matches` + (c.logoMatch != null ? ', and your logo held up well' : '') + (c.shapeMatch != null ? ', and the outline matches the front' : '') + '.</span>';
      } else if (state === 'warn') {
        const issues = [];
        for (const l of c.lines || []) if (!l.ok) issues.push(`it wrote “${escapeHtml(l.read || 'nothing')}” where you asked for “${escapeHtml(l.expected)}”`);
        if ((c.extraText || []).length) issues.push(`it added “${escapeHtml(c.extraText.join('”, “'))}”`);
        if (c.logoOk === false) issues.push('it changed your logo' + (c.logoIssues ? ` (${escapeHtml(c.logoIssues)})` : ''));
        if (c.shapeOk === false) issues.push('the outline does not match the front' + (c.shapeIssues ? ` (${escapeHtml(c.shapeIssues)})` : ''));
        html = `<strong>! ${name}: not quite right.</strong> On this version ${issues.join('; ') || 'something is off'}.`;
      }
      return `<p>${html} <button type="button" class="link" data-remove="${side}">Remove</button></p>`;
    });
    const state = coinState();
    box.className = 'ai-check ' + state;
    box.innerHTML = parts.join('') + (state === 'warn' ? '<p class="more">Make another version for a fresh one, or ask us to fix it below. Your real coin is made from your exact words and logo file, never from this picture.</p>' : '');
    box.hidden = false;
  }
  $('ai-check').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    const v = b && sideCurrent(b.dataset.remove);
    if (v) removeVersion(b.dataset.remove, v.id);
  });

  // ---------- "make another version": which side, and an optional note on what to change ----------
  // With a back of its own on screen the popup asks which side to redraw: both (the usual), the front (the back is
  // then drawn again to match it) or the back alone. The note goes to the side(s) chosen.
  const revise = { root: $('revise'), form: $('revise-form'), note: $('revise-note'), side: $('revise-side'), opener: null };
  function reviseSync() {
    const two = twoSided() && !!currentBack();
    revise.side.hidden = !two;
    for (const b of revise.side.children) b.classList.toggle('on', b.dataset.side === reviseSide);
    const v = reviseSide === 'back' ? currentBack() : currentFront();
    $('revise-coin').src = v ? v.image : '';
    $('revise-coin').hidden = !v;
    $('revise-foot').textContent = two && reviseSide === 'front'
      ? 'Your description and logo stay the same. The back is drawn again afterwards to match the new front.'
      : 'Your description and logo stay the same; the note and any pictures you add steer the new version.';
    renderRefs(); // the pictures box shows the side being redrawn
  }
  function openRevise() {
    if (ai.busy) return;
    revise.opener = document.activeElement;
    revise.note.value = '';
    reviseSide = twoSided() && currentBack() ? 'both' : 'front';
    reviseSync();
    openDialog(revise.root, revise.note);
  }
  const closeRevise = () => closeDialog(revise.root, revise.opener);
  $('ai-btn').addEventListener('click', openRevise);
  $('revise-close').addEventListener('click', closeRevise);
  revise.side.addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (b) { reviseSide = b.dataset.side; reviseSync(); } });
  revise.root.addEventListener('click', (e) => { if (e.target === revise.root) closeRevise(); });
  revise.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const note = revise.note.value;
    closeRevise();
    const sides = reviseSide === 'back' ? ['back'] : ['front', 'back'];
    generateCoin(sides, reviseSide === 'both' ? { front: note, back: note } : { [reviseSide]: note });
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


  // ---------- the "?" beside a text field ----------
  // Plenty of people have never described a coin before and freeze at an empty box. Each free-text field has a small
  // "?" in its label that opens a popup: what to cover, in plain words, and an example that can go straight into the
  // field as a starting point (only into an empty one; nothing of theirs is written over).
  const HELP = {
    front: {
      field: 'desc-front', title: '<span class="script">Describing</span> the front',
      lead: 'Picture the finished coin in your hand and say what you see, in plain words. There is no wrong way to put it. These are the things that help most:',
      items: [
        ['What is in the middle.', 'Your logo, a badge, an eagle, a building, a person, a vehicle. “Our logo in the middle” is plenty.'],
        ['The wording, in "double quotes".', 'A name, a motto, a date, a unit. Say where it goes: curved around the top, along the bottom, on a banner.'],
        ['What is behind it.', 'A flag, rays, a map, stars, or a plain enamel color.'],
        ['Colors.', 'Which parts are which color. Anything you do not color comes out as metal.'],
        ['Anything to leave out.', '“No stars”, “no text on the front”.'],
      ],
      example: 'Our logo in the middle, in full color. "CITY OF ASHLAND FIRE DEPT" curved around the top, "EST. 1990" along the bottom. Navy blue background behind the logo, with a white star on each side.',
    },
    back: {
      field: 'desc-back', title: '<span class="script">Describing</span> the back',
      lead: 'The back is the same coin turned over, so the shape, metal and border are already settled. Just say what goes on this side:',
      items: [
        ['The main picture.', 'An eagle, a crest, your state, a second logo, a flag, a vehicle.'],
        ['The wording, in "double quotes".', 'A motto around the edge, a name and a year in the middle. Say where it goes.'],
        ['Colors.', 'For any part that is not plain metal.'],
        ['Popular backs.', 'A motto with the year. A second logo. A flag. A blank space to engrave names later.'],
      ],
      example: 'A bald eagle with its wings spread over a waving American flag. "SERVICE BEFORE SELF" curved around the top, "2024" at the bottom. Red, white and blue enamel on the flag.',
    },
    style: {
      field: 'desc-style', title: '<span class="script">Style,</span> finish and theme',
      lead: 'How the coin should look as an object. Leave it blank and you get shiny gold with a plain rim. If you have a preference, mention any of these:',
      items: [
        ['Metal.', 'Shiny gold, antique gold, shiny silver, antique silver, black nickel, copper.'],
        ['Border.', 'Plain rim, rope border, beveled edge, stars around the edge, a reeded edge like a quarter.'],
        ['Color.', 'Full color, two or three colors, or no color at all for a plain metal coin.'],
        ['Mood.', 'Military, patriotic, corporate, vintage, playful, sports.'],
        ['Extras.', 'A sandblasted background, cutouts, glitter, glow in the dark.'],
      ],
      example: 'Antique silver with a rope border. Red and blue enamel. A classic, patriotic military look.',
    },
    notes: {
      field: 'notes', title: '<span class="script">Notes</span> for our team',
      lead: 'Anything the form did not ask about. A real person reads every word before your quote goes out. Things worth mentioning:',
      items: [
        ['A deadline.', 'When you need the coins in hand, and what for.'],
        ['Add-ons.', 'An epoxy dome, a key chain, a bottle opener, a velvet box, numbering, engraving.'],
        ['More than one quantity.', 'Ask for a second price to compare, like 100 and 250.'],
        ['Questions.', 'Anything you are unsure about. We answer with the quote.'],
      ],
      example: 'We need these by June 10 for a retirement ceremony. Please quote 100 and 250, and add velvet boxes.',
    },
  };
  const help = { root: $('help'), opener: null, id: null };
  function openHelp(id) {
    const h = HELP[id];
    if (!h) return;
    help.id = id;
    help.opener = document.activeElement;
    $('help-title').innerHTML = h.title;
    $('help-lead').textContent = h.lead;
    $('help-list').innerHTML = h.items.map(([what, how]) => `<li><b>${what}</b> ${how}</li>`).join('');
    $('help-example').textContent = h.example;
    $('help-use').hidden = !!$(h.field).value.trim();
    openDialog(help.root, $('help-ok'));
  }
  const closeHelp = () => closeDialog(help.root, help.opener);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.help-btn');
    if (!b) return;
    e.preventDefault(); // it sits inside the field's label; the tap is for the popup, not the field
    openHelp(b.dataset.help);
  });
  $('help-close').addEventListener('click', closeHelp);
  $('help-ok').addEventListener('click', closeHelp);
  $('help-use').addEventListener('click', () => {
    const field = $(HELP[help.id].field);
    field.value = HELP[help.id].example;
    field.dispatchEvent(new Event('input', { bubbles: true })); // the design follows the field, as if typed
    closeDialog(help.root, field);
  });
  help.root.addEventListener('click', (e) => { if (e.target === help.root) closeHelp(); });

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
    if (!help.root.hidden) closeHelp();
    else if (!contact.root.hidden) closeContact();
    else if (!revise.root.hidden) closeRevise();
    else if (nerd.open) closeNerd();
  });

  // Coin images cannot be right-clicked, long-pressed or dragged out of the page. This only stops casual saving
  // (a screenshot is always possible), which is why everything that reaches the browser is watermarked already.
  const isCoinImage = (t) => !!(t && t.closest && t.closest('.preview-col, .co-summary, .versions'));
  document.addEventListener('contextmenu', (e) => { if (isCoinImage(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => { if (e.target.tagName === 'IMG' || isCoinImage(e.target)) e.preventDefault(); });

  // ---------- steps ----------
  const STEPS = ['design', 'quote'];
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
    if (name === 'quote') updateOrderButton();
    syncDesign();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.querySelector('.panel').scrollTop = 0; // on a phone the form scrolls inside its own column
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
  $('to-quote').addEventListener('click', () => { if (rendered()) { optionsFromDesign(); showStep('quote'); readDesign(); } });

  // ---------- step 2: the quote ----------
  // How many, what size, who to send it to: one form. Quantity is typed in (no chips); the size comes from the list,
  // or "Other" with the size written in. The pricing estimate shows when the server has a price table.
  const form = $('quote-form');
  const qtyInput = $('qty-input');
  qtyInput.addEventListener('input', (e) => {
    const q = parseInt(e.target.value, 10);
    order.quantity = q > 0 && q <= 100000 ? q : null;
    updateEstimate();
  });
  $('notes').addEventListener('input', (e) => { order.notes = e.target.value; });
  const sizeOk = () => !!order.size && (order.size !== 'other' || !!order.sizeOther.trim());

  // ---- finish and color: the lists come from the price chart (config.catalog) ----
  // Only shown when the design could not be read (see "the design, read by the AI" below); the reading is the spec
  // otherwise. Packaging, rush and extra add-ons are not asked for: the customer puts them in the notes and the team
  // quotes them.
  const finishSelect = $('finish-select');
  const colorSelect = $('color-select');
  function buildOptions() {
    const cat = config.catalog;
    if (!config.pricing || !cat) return;
    finishSelect.innerHTML = cat.finishes.map((f) => `<option value="${f.key}">${escapeHtml(f.label)}</option>`).join('');
    colorSelect.innerHTML = cat.colors.map((c) => `<option value="${c.key}">${escapeHtml(c.label)}</option>`).join('');
    syncOptions();
  }
  // The metal finish the style notes name, as the chart groups them ("silver" alone reads as shiny silver / nickel)
  function guessFinish(text) {
    const t = String(text || '').toLowerCase();
    if (/black|gunmetal|dye/.test(t)) return 'black';
    if (/brass/.test(t)) return 'antique-brass';
    if (/copper/.test(t)) return 'copper';
    if (/(antique|satin)\s*silver|pewter/.test(t)) return 'antique-silver';
    if (/nickel|silver|chrome|steel|platinum/.test(t)) return 'shiny-nickel';
    return 'gold';
  }
  // The finish and the color sides start from the design; a choice the customer made themselves stays
  function optionsFromDesign() {
    if (!order.finishPicked) order.finish = guessFinish(design.style);
    if (!order.colorPicked) order.color = blankBack() ? 'one' : 'two';
    syncOptions();
  }
  function syncOptions() {
    if (!config.catalog) return;
    if (!order.finish) order.finish = guessFinish(design.style);
    finishSelect.value = order.finish;
    if (!finishSelect.value) { finishSelect.selectedIndex = 0; order.finish = finishSelect.value; }
    colorSelect.value = order.color;
    // The controls only appear when there is no reading of the design to price from
    $('options-group').hidden = !config.pricing || order.reading || !!order.analysis;
  }
  finishSelect.addEventListener('change', () => { order.finish = finishSelect.value; order.finishPicked = true; updateEstimate(); });
  colorSelect.addEventListener('change', () => { order.color = colorSelect.value; order.colorPicked = true; updateEstimate(); });
  const optionsPayload = () => ({ finish: order.finish, color: order.color, addons: order.addons, packaging: '', rush: false });

  // ---- the design, read by the AI ----
  // On the way to the quote the finished coin (front and back renders, plus the words) goes to the server, which has
  // a vision model say what it includes: the metal, which faces carry color, and the add-ons it actually shows (two
  // tone plating, a reeded edge, a keychain loop...). That reading IS the spec: the quote is priced from what the
  // coin shows, and the estimate says in a line what it was priced as. The estimate waits while the design is read.
  // Only when the design could not be read do the finish and color controls appear, guessed from the style notes.
  let readSeq = 0, readKey = '';
  const designReadKey = () => JSON.stringify([frontRenderId(), customBack() && currentBack() ? currentBack().renderId : null, designPayload()]);
  async function readDesign() {
    await configReady;
    if (!config.readDesign || !config.catalog) { order.reading = false; syncOptions(); updateEstimate(); return; }
    const key = designReadKey();
    if (key === readKey && order.analysis) { syncOptions(); updateEstimate(); return; } // this very design was read already
    const seq = ++readSeq;
    readKey = key;
    order.analysis = null;
    order.reading = true;
    syncOptions();
    updateEstimate(); // "reading your design" while the answer comes
    try {
      const bk = customBack() ? currentBack() : null;
      const r = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renderId: frontRenderId(), backRenderId: bk ? bk.renderId : null, design: designPayload() }),
      });
      const d = await r.json();
      if (seq !== readSeq) return; // they went back and changed the design; a newer reading is on its way
      const a = d.analysis;
      if (a && a.analyzed) {
        // The reading is the spec: finish, color sides and add-ons come from the design, whatever was guessed before
        order.analysis = a;
        if (a.finish) order.finish = a.finish;
        if (a.color) order.color = a.color;
        order.addons = a.addons.map((x) => x.key);
      } else order.addons = [];
    } catch (_) { if (seq === readSeq) order.addons = []; }
    if (seq !== readSeq) return;
    order.reading = false;
    syncOptions();
    updateEstimate();
  }

  // ---- the estimate ----
  let quoteSeq = 0;
  async function updateEstimate() {
    const ok = !!order.quantity && sizeOk();
    order.quote = null;
    const box = $('estimate');
    const seq = ++quoteSeq;
    if (!ok) { box.hidden = true; updateOrderButton(); return; }
    await configReady;
    if (seq !== quoteSeq) return;
    if (!config.pricing) {
      showUnpriced('Our team confirms exact pricing by email, usually within one business day.');
      return;
    }
    if (order.reading) {
      // The design is being read for the finish, color and add-ons: no price until it is
      box.className = 'estimate reading';
      $('quote-notes').textContent = 'Reading your design to price it…';
      box.hidden = false;
      updateOrderButton();
      return;
    }
    try {
      const p = new URLSearchParams({ size: order.size, quantity: String(order.quantity), ...optionsPayload(), addons: order.addons.join(',') });
      const r = await fetch(`/api/quote?${p}`);
      const d = await r.json();
      if (seq !== quoteSeq) return; // a newer answer is on its way
      const q = d.quote;
      if (q && q.priced) { order.quote = q; renderQuote(q); }
      else if (q && q.reason === 'quantity_over') showUnpriced(`Orders over ${q.max.toLocaleString()} coins are priced by hand. Send your request and our team quotes it within one business day.`);
      else if (q && q.reason === 'size') showUnpriced('A size off our list is priced by hand. Send your request and our team quotes it within one business day.');
      else showUnpriced('Our team confirms exact pricing by email, usually within one business day.');
    } catch (_) { box.hidden = true; updateOrderButton(); }
  }
  function showUnpriced(text) {
    const box = $('estimate');
    box.className = 'estimate unpriced';
    $('quote-notes').textContent = text;
    box.hidden = false;
    updateOrderButton();
  }
  // The total, a line on what it is priced as, the lines behind it folded away, and the small print
  function renderQuote(q) {
    const box = $('estimate');
    box.className = 'estimate';
    $('quote-total').textContent = money(q.total);
    const addons = q.lines.filter((l) => l.key.startsWith('addon:')).map((l) => l.label.toLowerCase());
    const as = [q.finishLabel.split(' / ')[0], q.colorIncluded ? 'color included' : q.colorLabel.toLowerCase(), ...addons];
    $('quote-summary').textContent = `${money(q.unit)} per coin · ${as.join(', ')}. Includes the mold${q.shipping != null ? ' and ground shipping' : ''}.`;
    $('quote-lines').innerHTML = quoteLinesHtml(q, 'li');
    const dep = config.payments ? depositOf(q.total) : null;
    $('quote-notes').textContent = (order.analysis ? 'Priced from what your design shows; anything else you need goes in the notes. ' : '') + 'Sales tax not included. Our team confirms the final quote with your proof.'
      + (dep ? ` A ${depositText(dep)} gets your order started; the balance is due when you approve your proof.` : '');
    box.hidden = false;
    updateOrderButton();
  }
  // The quote's lines as markup: label, detail and amount per line (used by the estimate box and the test checkout)
  const quoteLinesHtml = (q, tag) => q.lines.map((l) =>
    `<${tag}><span class="ql-label">${escapeHtml(l.label)}${l.detail ? `<small>${escapeHtml(l.detail)}</small>` : ''}</span>` +
    `<span class="ql-amount${l.amount === 0 ? ' ql-free' : ''}">${l.amount === 0 ? 'Free' : money(l.amount)}</span></${tag}>`).join('');

  form.addEventListener('input', (e) => {
    if (e.target && e.target.classList) e.target.classList.remove('bad');
    if (!form.querySelector('.bad')) $('quote-error').hidden = true;
  });
  // Everything is checked at once; what is missing is listed, and the first field that needs fixing is brought into view
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
    const v = (n) => form.elements[n].value.trim();
    const next = {
      name: v('name'), email: v('email'), phone: v('phone'), company: v('company'),
      street: v('street'), cityStateZip: v('cityStateZip'), country: v('country'),
    };

    const missing = [];
    const mark = (el, bad, label) => { el.classList.toggle('bad', bad); if (bad) missing.push(label); };
    mark(qtyInput, !order.quantity, 'how many coins');
    mark(sizeSelect, !order.size, 'the coin size');
    mark(sizeOtherInput, order.size === 'other' && !order.sizeOther.trim(), 'the size you have in mind');
    const required = [['name', 'your name'], ['email', 'your email'], ['street', 'your street address'], ['cityStateZip', 'city, state, ZIP'], ['country', 'country']];
    for (const [id, label] of required) mark(form.elements[id], !next[id], label);
    if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) { form.elements.email.classList.add('bad'); missing.push('a valid email'); }
    const err = $('quote-error');
    if (missing.length) {
      err.textContent = 'Please add: ' + missing.join(', ') + '.';
      err.hidden = false;
      const first = form.querySelector('.bad');
      if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); first.focus({ preventScroll: true }); }
      return;
    }
    err.hidden = true;
    Object.assign(order, next);
    placeOrder();
  });

  // "Get Started": with Stripe configured it opens checkout for the deposit; without, it sends the quote request
  function updateOrderButton() {
    $('place-order').textContent = isTest() ? 'Place Test Order' : 'Get Started';
  }

  async function placeOrder() {
    if (busy) return;
    busy = true;
    const btn = $('place-order');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    $('quote-error').hidden = true;
    try {
      const v = currentFront();
      const bk = customBack() ? currentBack() : null;
      const image = v ? v.image : null;
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          size: order.size,
          sizeOther: order.sizeOther.trim(),
          quantity: order.quantity,
          name: order.name, email: order.email, phone: order.phone, company: order.company,
          // one address is asked for; it is the billing address too
          billStreet: order.street, billCityStateZip: order.cityStateZip, billCountry: order.country,
          street: order.street, cityStateZip: order.cityStateZip, country: order.country,
          notes: order.notes,
          options: optionsPayload(),
          analysis: order.analysis,
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
        `<p>Your quote request <strong>${escapeHtml(data.orderId)}</strong> for ${order.quantity.toLocaleString()} ${escapeHtml(sizeText())} coins has been sent to the <strong>Coins for Anything team</strong>. ` +
        (order.quote && order.quote.priced ? `<p>Your estimate came to <strong>${money(order.quote.total)}</strong> (${escapeHtml(order.quote.finishLabel)}, ${escapeHtml(order.quote.colorLabel.toLowerCase())}). ` : '<p>') +
        `We'll be in touch at <strong>${escapeHtml(order.email)}</strong> with your ${order.quote && order.quote.priced ? 'confirmed quote' : 'quote'}, a proof to approve, and next steps within one business day.</p>` +
        '<p>The Quality is Always Here.</p>'
      );
    } catch (e) {
      const err = $('quote-error');
      err.textContent = e.message || 'Something went wrong. Please try again.';
      err.hidden = false;
      err.scrollIntoView({ behavior: 'smooth', block: 'center' }); // it sits at the foot of the form, out of sight on a phone
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
    renderTabs();
    document.querySelector('.panel').scrollTop = 0;
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
      const q = o.quote && o.quote.priced ? o.quote : null;
      const sample = !q;
      const amount = q ? q.total : Math.round(o.quantity * 6.95 * 100) / 100;
      $('co-coin').src = image || '';
      $('co-item').innerHTML = `<strong>${o.quantity.toLocaleString()} × Custom ${escapeHtml(sizeText())} ${q ? escapeHtml(q.finishLabel.split(' / ')[0]) + ' ' : ''}Coin</strong><br>` +
        `<span style="color:#999">Order ${escapeHtml(orderId)}${q ? ` &middot; ${money(q.unit)} each` : ''}</span>`;
      // What Stripe would ask for: the deposit when the rule gives one, else the whole quote
      const dep = depositOf(amount);
      const due = dep ? dep.amount : amount;
      $('co-lines').innerHTML = (q ? quoteLinesHtml(q, 'div') : `<div><span>Subtotal</span><span>${money(amount)}</span></div>`) +
        `<div class="co-total"><span>Total</span><span>${money(amount)}</span></div>` +
        (dep ? `<div class="co-total"><span>Deposit due today${dep.percent ? ` (${dep.percent}%)` : ''}</span><span>${money(due)}</span></div>` : '');
      $('co-note').textContent = sample ? 'Sample price shown: the chart could not price this order. Test mode only.' : (dep ? 'The balance is due when you approve your proof. ' : '') + 'Sales tax, if any, is added at checkout. Our team confirms the final quote with your proof.';
      co.form.reset();
      $('co-email').value = o.email;
      co.form.elements.cardName.value = o.name;
      co.pay.textContent = `Pay ${money(due)}`;
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
      const err = $('quote-error');
      err.innerHTML = `Checkout was closed for test order <strong>${escapeHtml(orderId)}</strong>. No charge was made. <button class="link" type="button" id="retry-pay">Open checkout again</button>`;
      err.hidden = false;
      err.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    configReady.then(() => showResult(paid
      ? `<p class="head"><span class="script">Thank you</span> for your order!</p><p>${config.deposit ? 'Your deposit is in' : 'Payment received'} for order <strong>${escapeHtml(orderId)}</strong>. A receipt is on its way to your inbox, and our team will be in touch with your proof${config.deposit ? ', the balance' : ''} and next steps.</p>`
      : `<p class="head">Checkout cancelled</p><p>No charge was made for order <strong>${escapeHtml(orderId)}</strong>. Our team still has your request and will follow up by email.</p>`));
    return true;
  }

  // ---------- form controls <- design state ----------
  function syncControls() {
    $('desc-front').value = design.front; $('desc-back').value = design.back; $('desc-style').value = design.style;
    for (const b of $('back-mode').children) b.classList.toggle('on', b.dataset.mode === design.backMode);
    $('back-custom').hidden = !customBack();
    syncShape();
    logoDrop.classList.remove('bad');
    logoDrop.querySelector('.logo-empty').hidden = !!design.logo;
    logoDrop.querySelector('.logo-have').hidden = !design.logo;
    if (design.logo) { $('logo-thumb').src = design.logo; $('logo-name').textContent = design.logoName; }
    sizeSelect.value = order.size || '';
    sizeOtherInput.value = order.sizeOther;
    $('size-other-field').hidden = order.size !== 'other';
    qtyInput.value = order.quantity || '';
  }

  // ---------- the Coin Nerd ----------
  // A round chat button waits in the corner while the coin is being designed and sized, with the mascot beside it
  // saying he is there to help. The chat is a short script, not an AI. Whichever way they come in, he first checks
  // what is filled in so far and shows it as a list of the form's steps; from there he walks them through the form,
  // lighting up one step at a time ("the walk-through" below). When everything is filled in and the coin is still
  // not what they want, he hands them to a designer (the quote page on the main site, or the fix-my-design form when
  // there is a render to fix).
  const QUOTE_URL = 'https://coinsforanything.com/quote/';
  const nerd = { root: $('nerd'), panel: $('nerd-panel'), log: $('nerd-log'), options: $('nerd-options'), toggle: $('nerd-toggle'), teaser: $('nerd-teaser'), open: false, started: false, run: 0, teaserTimer: null, guide: null, passed: new Set() };
  const nerdSeen = () => { try { return sessionStorage.getItem('cfaNerd') === '1'; } catch (_) { return false; } };
  const nerdMarkSeen = () => { try { sessionStorage.setItem('cfaNerd', '1'); } catch (_) {} };

  // The sections of the design step as he knows them. Each one matches a group of the form (data-guide in
  // index.html). tab: the section it is in on a phone. done: is it filled in? have: what they put there, for the list.
  // missing: what the list says while it is empty. why: what he says when it is the next thing to do.
  // tip: what he says beside the step while it is lit up.
  const clip = (s, n = 34) => { s = s.trim().replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const GUIDE = {
    files: {
      name: 'Reference files', tab: 'files',
      done: hasArt,
      have: () => [design.logo ? 'Logo added' : '', design.refs.length ? `${design.refs.length} reference photo${design.refs.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '),
      missing: 'Needed: add at least one',
      why: 'There is no logo or reference photo yet, and I need at least one to go on before I can draw your coin.',
      tip: () => (design.logo && design.refs.length ? 'A logo and photos, perfect. Say how to use the photos in your description, like “an eagle like the one in my photo”.'
        : design.logo ? 'Got your logo! It goes on the coin exactly as you uploaded it. Have a photo or a sketch of what you are picturing? Add it under <b>Photos, sketches or examples</b>.'
          : design.refs.length ? 'Nice, I’ll work from those. Say how to use them in your description, like “an eagle like the one in my photo”.'
            : 'Got a logo? Add it in the box and it goes on your coin exactly as it is. No logo? Add a photo or a sketch of what you have in mind under <b>Photos, sketches or examples</b>. I need at least one of them to go on.'),
    },
    front: {
      name: 'Describe the front', tab: 'front',
      done: () => !!design.front.trim(),
      have: () => `“${clip(design.front)}”`,
      missing: 'Not written yet',
      why: 'The front has no description yet, and that is the one thing I cannot draw a coin without.',
      tip: () => (!design.front.trim() ? 'This is the big one. Tell me what goes on the front and where, in plain words. Put exact wording in "double quotes", like "FIRE DEPT" around the top.'
        : !/["“”]/.test(design.front) ? 'Good start! Any wording that has to be spelled exactly goes in "double quotes", so I can check it letter by letter.'
          : 'That’s what I need. The more you tell me about what goes where, the closer the coin comes out.'),
    },
    back: {
      name: 'Describe the back', tab: 'back',
      done: () => !customBack() || !!design.back.trim(),
      have: () => (customBack() ? `“${clip(design.back)}”` : blankBack() ? 'Blank' : 'Same as the front'),
      missing: 'Not written yet',
      why: 'The back still needs a description, or a word that it is the same as the front or blank.',
      tip: () => (!customBack() ? (blankBack() ? 'A blank back: plain metal, nothing to draw. Easy.' : 'Same design on both sides. Nothing more to add here.')
        : !design.back.trim() ? 'Nearly every coin has its own back. Tell me what goes on it, with exact wording in "double quotes". Or pick <b>Same as the front</b> or <b>Blank</b>.'
          : 'Good. I draw the back right after the front, so the shape, metal and border match.'),
    },
    style: {
      name: 'Style and finish', tab: 'style', optional: true,
      done: () => !!design.style.trim(),
      have: () => `“${clip(design.style)}”`,
      missing: 'Blank: shiny gold, plain rim',
      why: 'There is nothing about the style yet. Tell me the metal, the colors and the border, and the coin comes out much closer to what you have in mind.',
      tip: () => (design.style.trim() ? 'Great, that sets the look. Anything else you would tell a designer goes here too.'
        : 'How should it look? Name the metal, the colors and the border, like “antique silver, rope border, red and blue enamel”. Leave it blank and you get shiny gold with a plain rim.'),
    },
    shape: {
      name: 'Round or odd shaped', tab: 'shape',
      done: () => design.shapePicked || ai.front.versions.length > 0,
      have: () => (oddShape() ? 'Odd shaped' : 'Round'),
      missing: 'Round, unless you change it',
      why: 'One thing left to choose: a round coin, or an odd shaped one.',
      tip: () => (oddShape() ? 'Odd shaped it is! Say which shape in your description or style notes: a shield, a star, your state. Left unsaid, I cut it to your artwork.'
        : design.shapePicked ? 'Round it is, the classic challenge coin.'
          : 'Round is the classic challenge coin. Pick <b>Odd shaped</b> for a shield, a star, your state, or a coin cut to your logo.'),
    },
  };
  const GUIDE_IDS = Object.keys(GUIDE);
  // Down the form on a wide screen; on a phone, in the order of the row under the coin
  const guideOrder = () => (studio.matches ? TABS.design.map(([tab]) => GUIDE_IDS.find((id) => GUIDE[id].tab === tab)).filter(Boolean) : GUIDE_IDS);
  const guideFirst = () => guideOrder().find((id) => !GUIDE[id].done()) || null;

  function nerdBubble(html, who) {
    const el = document.createElement('div');
    el.className = 'nerd-msg ' + who;
    el.innerHTML = html;
    nerd.log.appendChild(el);
    nerd.log.scrollTop = nerd.log.scrollHeight;
    return el;
  }
  // What is filled in so far: the steps as a list, the next one to do marked. A row goes straight to its step.
  function nerdStepsHtml() {
    const order = guideOrder();
    const done = order.filter((id) => GUIDE[id].done()).length;
    const next = order.find((id) => !GUIDE[id].done() && !nerd.passed.has(id)); // not one they chose to skip
    return `<p class="nerd-steps-head"><span><b>${done} of ${order.length}</b> done</span><span class="nerd-meter"><i style="width:${Math.round(done / order.length * 100)}%"></i></span></p>`
      + order.map((id, i) => {
        const g = GUIDE[id], ok = g.done();
        const note = ok ? g.have() : g.missing + (g.optional ? ' · optional' : '');
        return `<button type="button" class="nerd-step${ok ? ' done' : ''}${id === next ? ' next' : ''}" data-guide-go="${id}"><span class="num">${ok ? '✓' : i + 1}</span>`
          + `<span class="what"><b>${g.name}</b><small>${escapeHtml(note)}</small></span><span class="tag">${id !== next ? '' : done ? 'Next' : 'Start here'}</span></button>`;
      }).join('');
  }
  // There is one list in the chat at a time, and it keeps up with the form
  function nerdStepsSync() {
    const card = nerd.log.querySelector('.nerd-steps');
    if (!card) return;
    const html = nerdStepsHtml();
    if (card.dataset.html !== html) { card.innerHTML = html; card.dataset.html = html; }
  }
  // He "types" for a moment, then says it and offers the next choices: [{ id, label, quiet? }] or [{ href, label }].
  // steps: the list of what is filled in goes under what he said.
  async function nerdSay(html, options = [], { steps = false } = {}) {
    const run = ++nerd.run;
    nerd.options.innerHTML = '';
    const dots = nerdBubble('<span class="typing"><i></i><i></i><i></i></span>', 'nerd-says');
    await sleep(600);
    if (run !== nerd.run) { dots.remove(); return; }
    dots.innerHTML = html;
    if (steps) {
      for (const old of nerd.log.querySelectorAll('.nerd-steps')) old.remove();
      const card = document.createElement('div');
      card.className = 'nerd-steps';
      nerd.log.appendChild(card);
      nerdStepsSync();
    }
    nerd.options.innerHTML = options.map((o) => (o.href
      ? `<a class="btn small" href="${o.href}" target="_blank" rel="noopener">${o.label}</a>`
      : `<button type="button" class="btn small${o.quiet ? ' dark plain' : ''}" data-nerd="${o.id}">${o.label}</button>`)).join('');
    nerd.log.scrollTop = nerd.log.scrollHeight;
  }
  const NERD_START = [{ id: 'generate', label: 'I want to generate a coin' }, { id: 'stuck', label: 'I can’t generate a coin I like' }];
  const NERD_DESIGNER = { id: 'designer', label: 'I’d rather talk to a designer', quiet: true };
  const NERD = {
    generate() {
      const next = guideFirst();
      nerdSay(next
        ? `Easy! There are ${guideOrder().length} quick steps, then you tap <b>Generate This Coin</b>. I had a look at what you have so far. Next up: <b>${GUIDE[next].name.toLowerCase()}</b>.`
        : currentFront()
          ? 'You already have a render! Change your description and generate again, or tap <b>Make Another Version</b> and tell me what to do differently.'
          : 'Easy! You have filled in every step already. All that is left is to tap <b>Generate This Coin</b>, and your render shows up in a minute or two.',
      [{ id: 'go', label: next ? 'Show me what to do' : 'Take me there' }, { id: 'stuck', label: 'I can’t generate a coin I like', quiet: true }], { steps: true });
    },
    // Someone the builder is not working for: before anything else, what have they filled in, and what is missing?
    stuck() {
      const next = guideFirst();
      if (!next && currentFront()) {
        nerdSay('I had a look, and you have filled in every step, so this one is a job for our designers. Tell us what you have in mind and a real designer will work up your coin with you, free of charge. You can also call <a href="tel:+18665835434">1-866-583-5434</a>.',
          [{ href: QUOTE_URL, label: 'Get a Free Quote' }, { id: 'fix', label: 'Have a designer fix my render' }, { id: 'go', label: 'Let me try again myself', quiet: true }], { steps: true });
        return;
      }
      const none = !GUIDE_IDS.some((id) => GUIDE[id].done());
      nerdSay('Let’s sort that out. First, here is what you have filled in so far. ' + (none ? 'Nothing yet, so let’s go through it together, one step at a time.'
        : next ? GUIDE[next].why : 'Every step is filled in, so you are ready: all that is left is to tap <b>Generate This Coin</b>.'),
      [{ id: 'go', label: next ? 'Show me what to do' : 'Take me there' }, NERD_DESIGNER], { steps: true });
    },
    designer() {
      nerdSay('No problem, that is what our designers are for. Tell us what you have in mind and a real designer will work up your coin with you, free of charge. You can also call <a href="tel:+18665835434">1-866-583-5434</a>.',
        [{ href: QUOTE_URL, label: 'Get a Free Quote' }, ...(currentFront() ? [{ id: 'fix', label: 'Have a designer fix my render' }] : []), { id: 'generate', label: 'Show me how to generate a coin', quiet: true }]);
    },
    go() { closeNerd(); guideStart(); },
    fix() { closeNerd(); openContact(); },
  };
  function openNerd() {
    nerdMarkSeen();
    clearTimeout(nerd.teaserTimer);
    nerd.teaser.hidden = true;
    nerd.open = true;
    nerd.panel.hidden = false;
    nerd.toggle.setAttribute('aria-expanded', 'true');
    if (!nerd.started) { nerd.started = true; nerdSay('Hi, I’m the Coin Nerd! Need help finding what you’re looking for?', NERD_START); }
    nerd.log.scrollTop = nerd.log.scrollHeight;
  }
  function closeNerd() {
    nerd.open = false;
    nerd.panel.hidden = true;
    nerd.toggle.setAttribute('aria-expanded', 'false');
  }
  // He is around while the coin is being designed; once they are on to their quote he would only be in the way
  function nerdPlace() {
    const step = $('builder').dataset.step;
    const show = step === 'design';
    if (!show && nerd.open) closeNerd();
    nerd.root.hidden = !show;
    if (nerd.guide) {
      if (!show || ai.busy || $('result').innerHTML) nerd.guide = null;
      // on a phone the step's own Back and Next move through the sections, and he follows
      else if (studio.matches) nerd.guide = GUIDE_IDS.find((id) => GUIDE[id].tab === tabOpen.design) || null;
    }
    guideShow();
    nerdStepsSync();
  }
  nerd.toggle.addEventListener('click', () => (nerd.open ? closeNerd() : openNerd()));
  $('nerd-close').addEventListener('click', closeNerd);
  nerd.options.addEventListener('click', (e) => {
    const b = e.target.closest('[data-nerd]');
    if (!b || !NERD[b.dataset.nerd]) return;
    if (!['go', 'fix'].includes(b.dataset.nerd)) nerdBubble(escapeHtml(b.textContent), 'you');
    NERD[b.dataset.nerd]();
  });
  nerd.log.addEventListener('click', (e) => {
    const b = e.target.closest('[data-guide-go]');
    if (b) { closeNerd(); guideStart(b.dataset.guideGo); }
  });
  // A moment after the page opens he pipes up in a speech bubble: "Need some help? I'm here to help!" It sits over
  // the edge of the form, so it goes again after a few seconds (pointing at him brings it back, see style.css), and
  // once they have opened the chat in this visit he does not say it again.
  setTimeout(() => {
    if (nerdSeen() || nerd.open || nerd.root.hidden) return;
    nerd.teaser.hidden = false;
    nerd.teaserTimer = setTimeout(() => { nerd.teaser.hidden = true; }, 10000);
  }, 1500);

  // ---------- the walk-through ----------
  // The Coin Nerd takes them through the design step one section at a time. The section he is on is lit up in the
  // form (see "the walk-through" in style.css) with his face beside it saying what to do there, and a button to the
  // next one that still needs doing. After the last one he points at Generate (nerd.guide is then 'go'). On a phone
  // the sections already come one at a time with their own Back and Next, so there he only talks; nerdPlace keeps
  // him on the section on show.
  const coach = document.createElement('div');
  coach.className = 'coach';
  const designStep = document.querySelector('.panel .step[data-step="design"]');
  function guideStart(id) {
    if ($('result').innerHTML) return;
    if (id === undefined) nerd.passed.clear(); // from the chat: a fresh walk, starting at the first step not done
    id = id || guideFirst() || 'go';
    const order = guideOrder();
    if (id === 'go' && studio.matches) id = order[order.length - 1]; // on a phone Generate is on the last section
    nerd.guide = id;
    if ($('builder').dataset.step !== 'design') showStep('design');
    if (studio.matches) openTab(GUIDE[id].tab);
    else {
      guideShow();
      (id === 'go' ? coach : designStep.querySelector(`[data-guide="${id}"]`)).scrollIntoView({ behavior: 'smooth', block: 'center' });
      const field = id !== 'go' && designStep.querySelector(`[data-guide="${id}"] textarea`);
      if (field) field.focus({ preventScroll: true });
    }
  }
  function guideStop() {
    if (!nerd.guide) return;
    nerd.guide = null;
    guideShow();
  }
  // On to the next step that still needs doing; with none left, to Generate (or back to the pictures or the
  // description, if one was jumped over: there is no coin without them)
  function guideNext() {
    const order = guideOrder();
    nerd.passed.add(nerd.guide);
    if (nerd.guide === 'shape') design.shapePicked = true; // they looked at it and kept what was there
    const to = order.slice(order.indexOf(nerd.guide) + 1).find((id) => !GUIDE[id].done() && !nerd.passed.has(id));
    guideStart(to || (!hasArt() ? 'files' : !design.front.trim() ? 'front' : designReady() ? 'go' : 'back'));
    nerdStepsSync();
  }
  function guideShow() {
    const id = nerd.guide;
    const group = GUIDE[id] ? designStep.querySelector(`[data-guide="${id}"]`) : null;
    for (const el of designStep.querySelectorAll('.guide-on')) if (el !== group) el.classList.remove('guide-on');
    designStep.classList.toggle('guiding', !!group);
    // What he points at once the steps are done: Generate, or "Make Another Version" while this design has its render
    const order = guideOrder(), at = order.indexOf(id), last = at === order.length - 1;
    const ready = id === 'go' || (studio.matches && last);
    const target = !id || !ready ? null : currentFront() ? (studio.matches ? null : $('ai-btn')) : designReady() ? $('generate-btn') : null;
    for (const el of document.querySelectorAll('.guide-pulse')) if (el !== target) el.classList.remove('guide-pulse');
    if (target) target.classList.add('guide-pulse');
    if (!id) { coach.remove(); coach.dataset.html = ''; coach.dataset.step = ''; return; }

    const g = GUIDE[id];
    let says, button = '';
    if (g) {
      // While they type in the step he is on, he holds his line: a new one would be a different height and push
      // the field they are typing in up or down. It changes when they leave the field.
      const typing = group.contains(document.activeElement) && document.activeElement.matches('textarea');
      if (!(typing && coach.dataset.step === id)) { coach.dataset.step = id; coach.dataset.tip = g.tip(); }
      says = coach.dataset.tip;
      if (studio.matches && last) says += currentFront() ? '' : designReady() ? ' Then tap <b>Generate This Coin</b>.' : ` Then go back to <b>${!hasArt() ? 'Files' : !design.front.trim() ? 'Front' : 'Back'}</b>: I cannot draw a coin without it.`;
      const label = g.optional && !g.done() ? 'Skip this step' : 'Next step';
      button = `<button type="button" class="btn small coach-next"${!g.optional && id !== 'shape' && !g.done() ? ' disabled' : ''}>${label}</button>`;
    } else {
      coach.dataset.step = '';
      says = currentFront()
        ? 'This design already has its render. Change anything above and <b>Generate This Coin</b> comes back, or tap <b>Make Another Version</b> under the coin and tell me what to do differently.'
        : 'That’s everything! Tap <b>Generate This Coin</b> and your render shows up in a minute or two.';
    }
    const dots = order.map((k, i) => `<i class="${GUIDE[k].done() ? 'done' : ''}${i === at ? ' at' : ''}"></i>`).join('');
    const html = `<img class="coach-face" src="brand/coinnerd-head.webp" alt="" width="44" height="44">`
      + `<div class="coach-says"><p class="coach-top"><b>${g ? `Step ${at + 1} of ${order.length}` : 'Ready to go'}</b><span class="coach-dots" aria-hidden="true">${dots}</span></p>`
      + `<p class="coach-text">${says}</p>${button ? `<p class="coach-actions">${button}</p>` : ''}`
      + `<button type="button" class="coach-close" aria-label="Stop the walk-through">&times;</button></div>`;
    // Beside the step he is on: under its title, or over the step's buttons when he is pointing at Generate
    if (group) {
      const title = group.querySelector('.group-title');
      if (coach.previousElementSibling !== title) title.after(coach);
      group.classList.add('guide-on');
    } else if (coach.nextElementSibling !== $('design-hint')) $('design-hint').before(coach);
    if (coach.dataset.html !== html) {
      const held = coach.contains(document.activeElement); // the button just pressed is rebuilt: keep the keyboard here
      coach.innerHTML = html; coach.dataset.html = html;
      if (held) (coach.querySelector('.coach-next:not(:disabled)') || coach.querySelector('.coach-close')).focus({ preventScroll: true });
    }
  }
  coach.addEventListener('click', (e) => {
    if (e.target.closest('.coach-close')) guideStop();
    else if (e.target.closest('.coach-next')) guideNext();
  });
  designStep.addEventListener('focusout', (e) => { if (nerd.guide && e.target.matches('textarea')) setTimeout(guideShow, 0); }); // now he can say something new

  // ---------- restart ----------
  function restart() {
    Object.assign(design, newDesign());
    Object.assign(order, { quantity: null, size: null, sizeOther: '', quote: null, notes: '', finish: '', finishPicked: false, color: 'two', colorPicked: false, addons: [], analysis: null, reading: false, name: '', email: '', phone: '', company: '', street: '', cityStateZip: '', country: 'United States' });
    readKey = ''; readSeq++;
    ai.front = newSide(); ai.back = newSide();
    tabOpen.design = firstTab('design');
    guideStop();
    $('result').innerHTML = '';
    form.reset(); syncOptions(); // the whole quote form: quantity, size, finish and color, notes and the details
    for (const el of form.querySelectorAll('.bad')) el.classList.remove('bad');
    logoUrl.value = ''; logoUrl.classList.remove('bad');
    syncControls();
    $('estimate').hidden = true;
    $('quote-error').hidden = true;
    showStep('design');
  }
  $('restart').addEventListener('click', () => {
    // On a phone the button sits in the header, a stray thumb away: check before wiping a coin they have started
    const started = design.front.trim() || design.logo || design.refs.length || ai.front.versions.length;
    if (studio.matches && started && !$('result').innerHTML && !window.confirm('Start over? This clears your coin and your details.')) return;
    restart();
  });
  $('another').addEventListener('click', restart);

  // Choice buttons show their state with the `on` class; mirror it to aria-pressed for screen readers
  const CHOICES = '.seg button, .preview-tabs button, .version';
  const markPressed = (b) => b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false');
  new MutationObserver((muts) => { for (const m of muts) if (m.target.matches && m.target.matches(CHOICES)) markPressed(m.target); })
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  document.querySelectorAll(CHOICES).forEach(markPressed);

  // ---------- boot ----------
  if (!handleReturnFromCheckout()) showStep('design');
  else syncDesign();
})();
