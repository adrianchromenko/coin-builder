(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // The customer tells us what the coin is for and describes each face in their own words. There are no option
  // grids: the server turns the description into the AI prompt, and the artists finish the coin before production.
  // Size and quantity are typed in with the quote; the sizes on offer are the <select> in index.html (keep in step
  // with SIZES in lib/pricing.js), plus "other" with the size in their words.

  const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

  // ---------- state ----------
  const config = { pricing: false, payments: false, testMode: false, provider: '' };
  // backMode: 'custom' (its own description, rendered to match the front: nearly every coin), 'same' (the back is the
  //   front again) or 'blank' (plain metal, no design)
  // shape: 'round' or 'odd' (a custom outline: shield, star, state, cut to the artwork; the words say which)
  // shapePicked: they chose the shape themselves, rather than leaving it on round (the Coin Nerd's checklist asks)
  // refs: reference images the customer added besides the logo, as [{ id, name, data (a JPEG data URL), bad? }];
  //   backRefs: the same, for the back alone
  const newDesign = () => ({ front: '', back: '', backMode: 'custom', shape: 'round', shapePicked: false, style: '', logo: null, logoName: '', refs: [], backRefs: [] });
  const design = newDesign();
  // size: one of the sizes in the <select>, or 'other' with the size written in sizeOther
  const order = {
    quantity: null, size: null, sizeOther: '', estimate: null, notes: '',
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
  const blankBack = () => design.backMode === 'blank';
  const oddShape = () => design.shape === 'odd';
  const twoSided = () => customBack() && !!design.back.trim();
  // The pictures a render of the back is shown: its own, or the front's when it has none
  const backRefs = () => (design.backRefs.length ? design.backRefs : design.refs);
  const sideRefs = (side) => (side === 'back' ? backRefs() : design.refs);
  // The size in words, for the spec line, the test checkout and the thank-you
  const sizeText = () => (order.size === 'other' ? order.sizeOther.trim() || 'custom size' : order.size ? `${order.size}"` : '');
  // The design as the server records it on renders, orders and leads
  const designPayload = () => ({ shape: design.shape, front: design.front.trim(), back: twoSided() ? design.back.trim() : '', backMode: design.backMode, style: design.style.trim(), logoName: design.logoName, refNames: design.refs.map((r) => r.name), backRefNames: design.backRefs.map((r) => r.name) });

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
  // and each design step is walked through one section at a time (describe, images, style, shape, then the result),
  // with Back and Next at the bottom. On wider screens every section shows at once and none of this is visible.
  const studio = window.matchMedia('(max-width: 559px), (max-width: 720px) and (orientation: portrait)');
  // id, the name in the row under the coin, the line above the section (first word in script), optional?
  const TABS = {
    front: [
      ['describe', 'Describe', 'Describe', 'the front'],
      ['logo', 'Images', 'Add', 'your logo, seal or images'],
      ['style', 'Style', 'Pick', 'a style', true],
      ['shape', 'Shape', 'Choose', 'a shape'],
      ['result', 'Result', 'Here’s', 'your front'],
    ],
    back: [
      ['describe', 'Describe', 'Now', 'the back'],
      ['images', 'Images', 'Add', 'pictures for the back', true],
      ['result', 'Result', 'Here’s', 'your back'],
    ],
  };
  const tabOpen = { front: 'describe', back: 'describe' };
  // The sections of a design step. Result is one of them while the render it reports on is the one on screen; the
  // back's pictures only while the back has a design of its own.
  function tabsFor(step) {
    const result = TABS[step] && ai.side === step && !(step === 'back' && !customBack()) ? sideCurrent(step) : null;
    return { result, tabs: (TABS[step] || []).filter(([id]) => (id !== 'result' || result) && (id !== 'images' || customBack())) };
  }
  function renderTabs() {
    const step = $('builder').dataset.step;
    const { result, tabs } = tabsFor(step);
    if (tabs.length && !tabs.some(([id]) => id === tabOpen[step])) tabOpen[step] = 'describe';
    const open = tabs.length ? tabOpen[step] : '';
    if ($('builder').dataset.tab !== open) document.querySelector('.panel').scrollTop = 0; // a new section starts at its top
    $('builder').dataset.tab = open;
    const at = tabs.findIndex(([id]) => id === open);
    const inputs = tabs.filter(([id]) => id !== 'result');
    const filled = step === 'front'
      ? { describe: !!design.front.trim(), logo: !!design.logo || design.refs.length > 0, style: !!design.style.trim(), shape: true }
      : { describe: !customBack() || !!design.back.trim(), images: design.backRefs.length > 0 };

    // The row under the coin: the sections in order, lit up to the one on show. On Result a dot is the proofreader's verdict.
    const html = tabs.map(([id, label], i) => {
      const verdict = id === 'result' ? checkState(result).replace('unchecked', '') : '';
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
      const editing = !result && ai[step].versions.length > 0;
      const next = phone && !onResult && (result ? true : !editing && open !== inputs[inputs.length - 1][0]);
      const head = el.querySelector('.sub-head');
      const eyebrow = onResult ? `AI version ${result.number}` : inputs.length > 1 ? `Step ${at + 1} of ${inputs.length}${tab[4] ? ' · optional' : ''}` : '';
      const headHtml = phone ? `${eyebrow ? `<small>${eyebrow}</small>` : ''}<strong><span class="script">${tab[2]}</span>${tab[3]}</strong>` : '';
      if (head.dataset.html !== headHtml) { head.innerHTML = headHtml; head.dataset.html = headHtml; }
      const subBack = el.querySelector('.sub-back'), subNext = el.querySelector('.sub-next');
      subBack.hidden = !(phone && at > 0);
      subNext.hidden = !next;
      subNext.textContent = tab[4] && !filled[open] ? 'Skip' : 'Next';
      subNext.disabled = !onResult && ['describe', 'logo'].includes(open) && !filled[open]; // nothing to render without a description and a picture to go on
      const off = (node, on) => { if (node) node.classList.toggle('sub-off', on); };
      off(el.querySelector('#to-back, #to-quote'), phone && !!result && !onResult);
      off(el.querySelector('#generate-btn, #back-generate-btn'), next);
      off(el.querySelector('[data-back]'), phone && at > 0);
      off(el.querySelector('#design-hint, #back-hint'), next); // it talks about Generate and Continue, which are not on this screen
    }
    // The proofreading result and the offer to fix the design: in the Result tab on a phone, under the coin otherwise
    const slot = studio.matches && TABS[ai.side] ? document.querySelector(`.panel .step[data-step="${ai.side}"] .result-slot`) : null;
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
  studio.addEventListener('change', () => { renderTabs(); fitSoon(); });

  // The on-screen keyboard covers the bottom of the page without resizing it. While it is up, the shell and the popups
  // are fitted to the part of the screen that is left (--app-h, --app-top) and everything above the tabs steps aside
  // (.kb), so the field being typed in and the step's button stay in view.
  // The viewport reports in bursts while the keyboard slides and the page pans. The shell is refitted once per frame
  // at most, and only when something changed; refitting on every report makes it shake.
  // The keyboard is only reported once it has slid up, and by then the phone has panned the page to the tapped field;
  // rearranging the shell at that point makes the form jump twice. So the shell makes room in the tap itself (typing),
  // at the height the keyboard had last time (kbHeight): the field is already where it will stay, with nothing left to
  // pan to, and the report that follows changes little or nothing.
  const vv = window.visualViewport;
  const touch = window.matchMedia('(pointer: coarse)');
  const fitted = { kb: null, up: false, height: '', top: '' };
  let fitQueued = false;
  let typing = false, kbHeight = 0, kbWait = 0, kbAbsent = false;
  const typedIn = (el) => !!el && el.matches && el.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]):not([type="button"]):not([type="submit"])') && !el.readOnly && !el.disabled;
  function fitKeyboard() {
    fitQueued = false;
    const root = document.documentElement;
    const covered = vv && vv.scale < 1.1 ? window.innerHeight - vv.height : 0; // a pinch-zoom shrinks the viewport too
    const up = studio.matches && covered > 140;
    if (up) kbHeight = covered;
    else if (fitted.up) typing = false; // put away without leaving the field (Android's back button)
    const early = !up && typing && studio.matches;
    const kb = up || early || (studio.matches && window.innerHeight < 460);
    const height = up ? `${Math.round(vv.height)}px` : early && kbHeight ? `${Math.round(window.innerHeight - kbHeight)}px` : '';
    const top = up ? `${Math.round(vv.offsetTop)}px` : '';
    const resized = kb !== fitted.kb || height !== fitted.height;
    if (!resized && top === fitted.top) { fitted.up = up; return; }
    Object.assign(fitted, { kb, up, height, top });
    root.classList.toggle('kb', kb);
    root.style.setProperty('--app-h', height);
    root.style.setProperty('--app-top', top);
    // the field being typed in comes into view when the shell makes room, not each time the page is nudged
    if ((up || early) && resized && typedIn(document.activeElement)) document.activeElement.scrollIntoView({ block: 'nearest' });
  }
  const fitSoon = () => { if (!fitQueued) { fitQueued = true; requestAnimationFrame(fitKeyboard); } };
  if (vv) { vv.addEventListener('resize', fitSoon); vv.addEventListener('scroll', fitSoon); }
  window.addEventListener('resize', fitSoon);
  // A tap on a field: make room now, before the keyboard moves. A phone with no on-screen keyboard (one is plugged
  // in) never reports it, so the shell goes back to normal and stops making room for the rest of the visit.
  function startTyping(e) {
    if (typing || kbAbsent || !vv || !touch.matches || !studio.matches || !typedIn(e.target)) return;
    typing = true;
    fitKeyboard();
    clearTimeout(kbWait);
    kbWait = setTimeout(() => { if (typing && !fitted.up) { kbAbsent = true; typing = false; fitSoon(); } }, 1500);
  }
  document.addEventListener('focusin', startTyping);
  document.addEventListener('click', startTyping); // a field still in focus after the keyboard was put away
  document.addEventListener('focusout', (e) => { if (typing && !typedIn(e.relatedTarget)) { typing = false; fitSoon(); } });

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

  // A coin cannot be generated from words alone: it needs the logo or at least one reference image as well
  const hasArt = () => !!design.logo || design.refs.length > 0;
  const designReady = () => !!design.front.trim() && hasArt();
  function specLine() {
    const refs = design.refs.length + design.backRefs.length;
    const back = customBack() ? (design.back.trim() ? 'Front & back' : '') : blankBack() ? 'Blank back' : 'Same both sides';
    return [sizeText(), oddShape() ? 'Odd shaped' : '', back, design.logoName ? 'Your logo' : '', refs ? `${refs} reference${refs > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
  }
  // What a render of each face depends on. A back render is also tied to the front render it was matched against.
  const logoKey = () => (design.logo ? design.logo.length : 0);
  const refsKey = (list) => list.map((r) => r.id).join();
  const frontSignature = () => JSON.stringify({ shape: design.shape, front: design.front.trim(), style: design.style.trim(), logoName: design.logoName, logo: logoKey(), refs: refsKey(design.refs) });
  const backSignature = () => JSON.stringify({ shape: design.shape, back: design.back.trim(), style: design.style.trim(), logoName: design.logoName, logo: logoKey(), refs: refsKey(backRefs()), front: frontKey() });
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
    $('to-back').disabled = !front;
    $('design-hint').textContent = !hasArt()
      ? (design.front.trim() ? 'Add your logo or a reference image to go on. We need at least one before we can draw your coin.' : 'Start with your logo or a reference image, then describe the front of your coin.')
      : !design.front.trim()
        ? 'Describe the front of your coin: what goes on it, and where.'
        : !front
          ? (ai.front.versions.length ? 'The description changed. Tap "Generate This Coin" to render it again.' : 'Looking good. Tap "Generate This Coin" to see it rendered.')
          : 'Happy with the front? Continue to the back. Not quite? Change the description or make another version.';

    // Back step: a design of its own has to be generated to match the front; "same as the front" and "blank" need nothing more
    const backText = design.back.trim();
    $('back-custom').hidden = !customBack();
    $('back-images').hidden = !customBack();
    for (const b of $('back-mode').children) b.classList.toggle('on', b.dataset.mode === design.backMode);
    const backDone = !customBack() || !!back;
    $('back-generate-btn').hidden = backDone;
    $('back-generate-btn').disabled = !backText || !front || ai.busy;
    $('to-quote').hidden = !backDone;
    $('back-hint').textContent = !front
      ? 'Generate the front first; the back is drawn to match it.'
      : blankBack()
        ? 'The back will be plain metal with no design. Continue to your quote, or choose "A different design".'
        : !customBack()
          ? 'The back will carry the same design as the front. Continue to your quote, or choose "A different design".'
          : !backText
            ? 'Describe the back: what goes on it, and where.'
            : !back
              ? (ai.back.versions.length ? 'The back or the front changed. Tap "Generate the Back" to render it again to match.' : 'Tap "Generate the Back" to see it rendered to match your front.')
              : 'Happy with it? Continue to your quote. Not quite? Change the description or make another version.';
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
  const REF_BOXES = [['refs', 'ref-add', 'ref-files', () => 'front'], ['back-refs', 'back-ref-add', 'back-ref-files', () => 'back'], ['revise-refs', 'revise-ref-add', 'revise-ref-files', () => ai.side]];
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
    tabOpen.front = 'logo';
    showStep('front');
  });
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) { setLogo(it.getAsFile()); tabOpen.front = 'logo'; showStep('front'); break; }
    }
  });

  // ---------- the waiting coin ----------
  // Until there is a render, a gold coin waits on the empty face (see "the waiting coin" in style.css). It is the
  // loading coin's twin, built from the same parts: two faces with a stack of discs between them for its thickness,
  // and sparks around it. It carries the customer's logo once they have added one; until then, a star.
  const idleCoins = [...document.querySelectorAll('.coin-mark')];
  idleCoins.forEach((el, k) => {
    const id = (name) => `idle${k}-${name}`;
    const disc = `<circle cx="100" cy="100" r="100" fill="url(#${id('gold')})"/><circle class="mint-rim" cx="100" cy="100" r="93"/><circle class="mint-beads" cx="100" cy="100" r="89"/><circle class="mint-field" cx="100" cy="100" r="52"/>`;
    const arc = (where, text, small) => `<text${small ? ' class="mint-small"' : ''}><textPath href="#${id(where)}" startOffset="50%">${text}</textPath></text>`;
    const edge = Array.from({ length: 13 }, (_, z) => `<i class="mint-edge" style="--z:${z - 6}"></i>`).join('');
    const sparks = [[0, 10, 0], [96, 16, 1.3], [90, 88, .6], [4, 80, 2]].map(([x, y, d]) => `<i class="mint-spark" style="--x:${x}%;--y:${y}%;--d:${d}s"></i>`).join('');
    el.innerHTML = `<span class="coin-float"><span class="coin-turn">
      <span class="mint-face mint-front"><svg viewBox="0 0 200 200">
        <defs>
          <radialGradient id="${id('gold')}" cx="34%" cy="28%" r="85%"><stop offset="0" stop-color="#FFF3B0"/><stop offset=".32" stop-color="#EBC24A"/><stop offset=".72" stop-color="#BA871B"/><stop offset="1" stop-color="#7A5510"/></radialGradient>
          <path id="${id('top')}" d="M 30 100 A 70 70 0 0 1 170 100"/><path id="${id('bottom')}" d="M 17 100 A 83 83 0 0 0 183 100"/>
        </defs>
        ${disc}${arc('top', 'COINS FOR ANYTHING')}${arc('bottom', '★ YOUR COIN HERE ★')}
        <polygon class="mint-mark" points="100,70 107.35,89.89 128.53,90.73 111.89,103.86 117.63,124.27 100,112.5 82.37,124.27 88.11,103.86 71.47,90.73 92.65,89.89"/>
        <image class="mint-logo" x="64" y="64" width="72" height="72" preserveAspectRatio="xMidYMid meet" style="display:none"/>
      </svg></span>
      <span class="mint-face mint-back"><svg viewBox="0 0 200 200">${disc}${arc('top', 'THE QUALITY IS ALWAYS HERE', true)}${arc('bottom', '★ VETERAN OWNED ★')}<text class="mint-mono" x="100" y="116">CFA</text></svg></span>
      ${edge}</span></span>${sparks}`;
  });
  let idleLogoShown = null;
  function idleLogo() {
    if (idleLogoShown === design.logo) return;
    idleLogoShown = design.logo;
    for (const el of idleCoins) {
      const img = el.querySelector('.mint-logo');
      img.style.display = design.logo ? '' : 'none';
      el.querySelector('.mint-mark').style.display = design.logo ? 'none' : '';
      if (design.logo) img.setAttribute('href', design.logo); else img.removeAttribute('href');
    }
  }

  // ---------- the render on screen ----------
  // One coin on the front step. From the back step on, both faces side by side: the front on the left and, on the
  // right, the back render, or the front again (dimmed) when the back is "same as the front".
  function renderPreview() {
    const front = currentFront();
    const back = currentBack();
    const two = $('builder').dataset.step !== 'front';
    $('stage').classList.toggle('two', two);
    // Nothing to show and nothing on its way: small screens shrink the stage to a short banner
    $('stage').classList.toggle('empty', !two && !front && !ai.busy);
    document.querySelector('.preview').classList.toggle('two', two);
    idleLogo();
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
    setFace('front', front, { hint: 'Add your logo or a reference image, describe your coin, then tap <b>Generate This Coin</b>. Your render shows up here in a minute or two.' });
    $('face-back').hidden = !two;
    if (two) {
      if (blankBack()) setFace('back', null, { hint: 'The back is plain metal, with no design.' });
      else if (!customBack()) setFace('back', front, { same: true, hint: 'The back matches the front.' });
      else setFace('back', back, { hint: 'Describe the back, then tap <b>Generate the Back</b>. It is drawn to match your front.' });
    }
    const shown = sideCurrent(ai.side);
    $('preview-caption').textContent = shown
      ? (shown.demo
        ? (isTest() ? 'Test mode: a stand-in for the AI render.' : 'Demo render (add an API key on the server for real AI renders).')
        : `${ai.side === 'back' ? 'Back' : 'Front'}, AI version ${shown.number}, shown with a light preview watermark. The artwork made for your order is clean and full quality.`)
      : ai.side === 'back' && blankBack() ? 'A blank back: plain metal.' : ai.side === 'back' && !customBack() ? 'Same design on both sides.' : 'Your AI render appears here.';
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
  const progress = { sides: new Map(), overall: null, timer: null, source: null, started: 0, line: -1, lines: [] };
  // Something to read under the turning coin; the line changes every few seconds. First how long it takes, then fun
  // facts about Coins For Anything with a tip between them now and then. The facts come in a new order for each
  // render, since most customers sit through several. Each fits on two lines of a phone, so keep new ones under about
  // 80 characters. (The figures match the line at the foot of the page.)
  const WAIT_FIRST = 'Usually takes one to two minutes.';
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
  function waitLines() {
    const facts = WAIT_FACTS.map((text) => ['Fun fact:', text]);
    for (let i = facts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [facts[i], facts[j]] = [facts[j], facts[i]]; }
    WAIT_TIPS.forEach((text, i) => facts.splice(3 + i * 5, 0, ['', text]));
    return [['', WAIT_FIRST], ...facts];
  }
  // The loading coin (see "the mint" in style.css): its thickness is a stack of discs between the two faces, and
  // sparks sit around the ring
  (function buildMint() {
    const coin = document.querySelector('.mint-coin');
    for (let z = -6; z <= 6; z++) { const e = document.createElement('i'); e.className = 'mint-edge'; e.style.setProperty('--z', z); coin.appendChild(e); }
    const sparks = [[6, 16, 0], [88, 8, .9], [98, 56, 1.7], [80, 90, .4], [12, 84, 1.3], [-2, 46, 2.1], [48, -5, 2.4]];
    for (const [x, y, d] of sparks) { const e = document.createElement('i'); e.className = 'mint-spark'; e.style.cssText = `--x:${x}%;--y:${y}%;--d:${d}s`; $('mint').appendChild(e); }
  })();
  // The customer's own logo goes on the loading coin's face; without one it carries a star
  function mintLogo(logo) {
    $('mint-logo').style.display = logo ? '' : 'none';
    $('mint-star').style.display = logo ? 'none' : '';
    if (logo) $('mint-logo').setAttribute('href', logo); else $('mint-logo').removeAttribute('href');
  }
  function progressReset() {
    progress.sides.clear(); progress.overall = null;
    progress.started = Date.now(); progress.line = -1; progress.lines = waitLines();
    progressSet('starting');
    progressTick();
    clearInterval(progress.timer);
    progress.timer = setInterval(progressTick, 250);
  }
  function progressSet(stage, side) {
    const s = STAGES[stage] || STAGES.starting;
    const entry = { stage, from: s.from, to: s.to, seconds: s.seconds, started: Date.now() };
    if (side) progress.sides.set(side, entry); else progress.overall = entry;
    const says = stage === 'checking' && progress.sides.size > 1 ? 'Hang on, I’m proofreading both sides…'
      : stage === 'rendering' && progress.sides.size > 1 ? 'Striking the front and the back…' : s.text;
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
    const pct = Math.round(entries.reduce((n, e) => n + stagePct(e), 0) / entries.length);
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

  // note: what the customer wants different in this version (optional, from the "Make Another Version" popup)
  async function aiRender(side, note = '') {
    if (ai.busy) return;
    note = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (side === 'front' && !designReady()) { toast(hasArt() ? 'Describe the front of your coin first.' : 'Add your logo or a reference image first.'); return; }
    if (side === 'back' && !currentFront()) { toast('Generate the front first; the back is drawn to match it.'); return; }
    if (side === 'back' && !design.back.trim()) { toast('Describe the back first.'); return; }
    ai.busy = true;
    ai.side = side;
    guideStop(); // the Coin Nerd's walk-through ends where the render begins
    const genBtn = $(side === 'back' ? 'back-generate-btn' : 'generate-btn');
    const genLabel = genBtn.textContent;
    $('ai-btn').disabled = true;
    genBtn.disabled = true;
    genBtn.textContent = 'Generating…';
    $('preview-busy').dataset.face = side;
    $('preview-busy').hidden = false;
    renderPreview();
    revealStage();
    mintLogo(design.logo);
    progressReset();
    // refs: the pictures this render is shown (the back's own, or the front's when it has none)
    const snapshot = { ...designPayload(), logo: design.logo, refs: sideRefs(side).slice(), backRefs: design.backRefs.slice() };
    const text = side === 'back' ? snapshot.back : snapshot.front;
    const signature = sideSignature(side);
    const anchor = frontRenderId(); // the front this back is drawn to match
    const anchorKey = frontKey();
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
        progress.source = progressListen(progressId);
        const form = new FormData();
        if (snapshot.logo) form.append('logo', await (await fetch(snapshot.logo)).blob(), 'logo.png');
        for (const [i, r] of snapshot.refs.entries()) form.append('refs', await (await fetch(r.data)).blob(), `reference-${i + 1}.jpg`);
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
        if (!res.ok) {
          if (data.rejected) markRejected(snapshot, data.rejected);
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
      if (signature === sideSignature(side)) { tabOpen[side] = 'result'; showVersion(side, version.id); } // on a phone: straight to what the proofreader found
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
      if (side === 'front') Object.assign(design, { shape: d.shape || 'round', front: d.front, style: d.style, logo: d.logo, logoName: d.logoName, refs: (d.refs || []).slice() });
      else Object.assign(design, { back: d.back, backMode: 'custom', backRefs: (d.backRefs || []).slice() });
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
  let versionsHtml = '';
  function renderVersions() {
    const side = ai.side;
    const s = ai[side];
    const wrap = $('versions-wrap');
    const active = side === 'front' || customBack();
    wrap.hidden = !s.versions.length || !active;
    $('versions-label').textContent = side === 'back' ? 'Back versions' : 'Front versions';
    $('ai-btn').hidden = !s.versions.length || !active; // the first render of a face starts from its step
    const html = s.versions.map((v) => {
      const state = checkState(v);
      const stale = side === 'back' && backStale(v);
      const label = `${side === 'back' ? 'Back' : 'Front'} version ${v.number}` + (stale ? ', drawn for a different front' : state === 'ok' ? ', wording checked' : state === 'warn' ? ', needs a look' : '') + (v.note ? `. Asked for: ${v.note}` : '');
      return `<button type="button" class="version${v.id === s.current ? ' on' : ''} ${state}${stale ? ' stale' : ''}" data-version="${v.id}" data-side="${side}" aria-pressed="${v.id === s.current}" aria-label="${label}" title="${label}">` +
        `<img src="${v.image}" alt=""><span class="num">${v.number}</span>${state === 'unchecked' || stale ? '' : `<span class="flag" aria-hidden="true">${state === 'ok' ? '✓' : '!'}</span>`}</button>`;
    }).join('');
    if (html !== versionsHtml) { $('versions').innerHTML = html; versionsHtml = html; } // rebuilt only when it changes, not on every keystroke
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
      html = '<strong>✓ Wording checked.</strong><span class="more"> We read this render back letter by letter and every quoted word matches' + (c.logoMatch != null ? ', and your logo held up well' : '') + (c.shapeMatch != null ? ', and the outline matches your front' : '') + '.</span>';
    } else if (state === 'warn') {
      const issues = [];
      for (const l of c.lines || []) if (!l.ok) issues.push(`${/^(front|back) /.test(l.where) ? `on the ${l.where.split(' ')[0]} ` : ''}it wrote “${escapeHtml(l.read || 'nothing')}” where you asked for “${escapeHtml(l.expected)}”`);
      if ((c.extraText || []).length) issues.push(`it added “${escapeHtml(c.extraText.join('”, “'))}”`);
      if (c.logoOk === false) issues.push('it changed your logo' + (c.logoIssues ? ` (${escapeHtml(c.logoIssues)})` : ''));
      if (c.shapeOk === false) issues.push('the outline does not match your front' + (c.shapeIssues ? ` (${escapeHtml(c.shapeIssues)})` : ''));
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
    else if (!revise.root.hidden) closeRevise();
    else if (nerd.open) closeNerd();
  });

  // Coin images cannot be right-clicked, long-pressed or dragged out of the page. This only stops casual saving
  // (a screenshot is always possible), which is why everything that reaches the browser is watermarked already.
  const isCoinImage = (t) => !!(t && t.closest && t.closest('.preview-col, .co-summary, .versions'));
  document.addEventListener('contextmenu', (e) => { if (isCoinImage(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => { if (e.target.tagName === 'IMG' || isCoinImage(e.target)) e.preventDefault(); });

  // ---------- steps ----------
  const STEPS = ['front', 'back', 'quote'];
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
  $('to-back').addEventListener('click', () => { if (currentFront()) showStep('back'); });
  $('to-quote').addEventListener('click', () => { if (currentFront() && (!customBack() || currentBack())) showStep('quote'); });

  // ---------- step 3: the quote ----------
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

  async function updateEstimate() {
    const ok = !!order.quantity && sizeOk();
    order.estimate = null;
    const box = $('estimate');
    if (!ok) { box.hidden = true; updateOrderButton(); return; }
    await configReady;
    if (!config.pricing || order.size === 'other') {
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

  const same = form.elements.same;
  const syncShip = () => { $('ship-fields').hidden = same.checked; };
  same.addEventListener('change', syncShip);
  syncShip();
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
      billStreet: v('billStreet'), billCityStateZip: v('billCityStateZip'), billCountry: v('billCountry'),
    };
    if (same.checked) { next.street = next.billStreet; next.cityStateZip = next.billCityStateZip; next.country = next.billCountry; }
    else { next.street = v('street'); next.cityStateZip = v('cityStateZip'); next.country = v('country'); }

    const missing = [];
    const mark = (el, bad, label) => { el.classList.toggle('bad', bad); if (bad) missing.push(label); };
    mark(qtyInput, !order.quantity, 'how many coins');
    mark(sizeSelect, !order.size, 'the coin size');
    mark(sizeOtherInput, order.size === 'other' && !order.sizeOther.trim(), 'the size you have in mind');
    const required = [
      ['name', 'your name'], ['email', 'your email'],
      ['billStreet', 'billing street address'], ['billCityStateZip', 'billing city, state, ZIP'], ['billCountry', 'billing country'],
      ['street', 'shipping street address'], ['cityStateZip', 'shipping city, state, ZIP'], ['country', 'shipping country'],
    ];
    for (const [id, label] of required) {
      const skip = same.checked && ['street', 'cityStateZip', 'country'].includes(id);
      mark(form.elements[id], !skip && !next[id], label);
    }
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

  function updateOrderButton() {
    $('place-order').textContent = isTest() ? 'Place Test Order' : (config.payments && order.estimate ? 'Pay Now' : 'Submit for Quote');
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
        `<p>Your quote request <strong>${escapeHtml(data.orderId)}</strong> for ${order.quantity.toLocaleString()} ${escapeHtml(sizeText())} coins has been sent to the <strong>Coins for Anything team</strong>. ` +
        `We'll be in touch at <strong>${escapeHtml(order.email)}</strong> ${order.estimate ? 'with your quote, a proof to approve, and next steps' : 'with your quote, a proof to approve, and next steps'} within one business day.</p>` +
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
      const sample = !o.estimate;
      const amount = o.estimate ? o.estimate.total : Math.round(o.quantity * 6.95 * 100) / 100;
      $('co-coin').src = image || '';
      $('co-item').innerHTML = `<strong>${o.quantity.toLocaleString()} × Custom ${escapeHtml(sizeText())} Coin</strong><br>` +
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
    $('back-images').hidden = !customBack();
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

  // The steps of the front as he knows them. Each one matches a group of the form (data-guide in index.html).
  // tab: the section it is in on a phone. done: is it filled in? have: what they put there, for the list.
  // missing: what the list says while it is empty. why: what he says when it is the next thing to do.
  // tip: what he says beside the step while it is lit up.
  const clip = (s, n = 34) => { s = s.trim().replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const GUIDE = {
    logo: {
      name: 'Logo and reference photos', tab: 'logo',
      done: hasArt,
      have: () => [design.logo ? 'Logo added' : '', design.refs.length ? `${design.refs.length} reference photo${design.refs.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '),
      missing: 'Needed: add at least one',
      why: 'There is no logo or reference photo yet, and I need at least one to go on before I can draw your coin.',
      tip: () => (design.logo && design.refs.length ? 'A logo and photos, perfect. Say how to use the photos in your description, like “an eagle like the one in my photo”.'
        : design.logo ? 'Got your logo! It goes on the coin exactly as you uploaded it. Have a photo or a sketch of what you are picturing? Add it under <b>Reference images</b>.'
          : design.refs.length ? 'Nice, I’ll work from those. Say how to use them in your description, like “an eagle like the one in my photo”.'
            : 'Got a logo? Add it in the box and it goes on your coin exactly as it is. No logo? Add a photo or a sketch of what you have in mind under <b>Reference images</b>. I need at least one of them to go on.'),
    },
    describe: {
      name: 'Describe the front', tab: 'describe',
      done: () => !!design.front.trim(),
      have: () => `“${clip(design.front)}”`,
      missing: 'Not written yet',
      why: 'The front has no description yet, and that is the one thing I cannot draw a coin without.',
      tip: () => (!design.front.trim() ? 'This is the big one. Tell me what goes on the front and where, in plain words. Put exact wording in "double quotes", like "FIRE DEPT" around the top.'
        : !/["“”]/.test(design.front) ? 'Good start! Any wording that has to be spelled exactly goes in "double quotes", so I can check it letter by letter.'
          : 'That’s what I need. The more you tell me about what goes where, the closer the coin comes out.'),
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
  const guideOrder = () => (studio.matches ? TABS.front.map(([tab]) => GUIDE_IDS.find((id) => GUIDE[id].tab === tab)).filter(Boolean) : GUIDE_IDS);
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
    const show = ['front', 'back'].includes(step);
    if (!show && nerd.open) closeNerd();
    nerd.root.hidden = !show;
    if (nerd.guide) {
      if (step !== 'front' || ai.busy || $('result').innerHTML) nerd.guide = null;
      // on a phone the step's own Back and Next move through the sections, and he follows
      else if (studio.matches) nerd.guide = GUIDE_IDS.find((id) => GUIDE[id].tab === tabOpen.front) || null;
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
  // The Coin Nerd takes them through the front one step at a time. The step he is on is lit up in the form (see "the
  // walk-through" in style.css) with his face beside it saying what to do there, and a button to the next step that
  // still needs doing. After the last one he points at Generate (nerd.guide is then 'go'). On a phone the sections
  // already come one at a time with their own Back and Next, so there he only talks; nerdPlace keeps him on the
  // section on show.
  const coach = document.createElement('div');
  coach.className = 'coach';
  const frontStep = document.querySelector('.panel .step[data-step="front"]');
  function guideStart(id) {
    if ($('result').innerHTML) return;
    if (id === undefined) nerd.passed.clear(); // from the chat: a fresh walk, starting at the first step not done
    id = id || guideFirst() || 'go';
    const order = guideOrder();
    if (id === 'go' && studio.matches) id = order[order.length - 1]; // on a phone Generate is on the last section
    nerd.guide = id;
    if ($('builder').dataset.step !== 'front') showStep('front');
    if (studio.matches) openTab(GUIDE[id].tab);
    else {
      guideShow();
      (id === 'go' ? coach : frontStep.querySelector(`[data-guide="${id}"]`)).scrollIntoView({ behavior: 'smooth', block: 'center' });
      const field = id !== 'go' && frontStep.querySelector(`[data-guide="${id}"] textarea`);
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
    guideStart(to || (!hasArt() ? 'logo' : designReady() ? 'go' : 'describe'));
    nerdStepsSync();
  }
  function guideShow() {
    const id = nerd.guide;
    const group = GUIDE[id] ? frontStep.querySelector(`[data-guide="${id}"]`) : null;
    for (const el of frontStep.querySelectorAll('.guide-on')) if (el !== group) el.classList.remove('guide-on');
    frontStep.classList.toggle('guiding', !!group);
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
      if (studio.matches && last) says += currentFront() ? '' : designReady() ? ' Then tap <b>Generate This Coin</b>.' : ` Then go back to <b>${hasArt() ? 'Describe' : 'Images'}</b>: I cannot draw a coin without it.`;
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
  frontStep.addEventListener('focusout', (e) => { if (nerd.guide && e.target.matches('textarea')) setTimeout(guideShow, 0); }); // now he can say something new

  // ---------- restart ----------
  function restart() {
    Object.assign(design, newDesign());
    Object.assign(order, { quantity: null, size: null, sizeOther: '', estimate: null, notes: '', name: '', email: '', phone: '', company: '', billStreet: '', billCityStateZip: '', billCountry: 'United States', street: '', cityStateZip: '', country: 'United States' });
    ai.front = newSide(); ai.back = newSide(); ai.side = 'front';
    tabOpen.front = tabOpen.back = 'describe';
    guideStop();
    $('result').innerHTML = '';
    form.reset(); syncShip(); // the whole quote form: quantity, size, notes and the details
    for (const el of form.querySelectorAll('.bad')) el.classList.remove('bad');
    logoUrl.value = ''; logoUrl.classList.remove('bad');
    syncControls();
    $('estimate').hidden = true;
    $('quote-error').hidden = true;
    showStep('front');
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
  if (!handleReturnFromCheckout()) showStep('front');
  else syncDesign();
  fitKeyboard();
})();
