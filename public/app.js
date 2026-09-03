(() => {
  'use strict';

  const chat = document.getElementById('chat');
  const chips = document.getElementById('chips');
  const composer = document.getElementById('composer');
  const textInput = document.getElementById('text');
  const fileInput = document.getElementById('file');
  const sendBtn = document.getElementById('send');
  const restartBtn = document.getElementById('restart');
  const drop = document.getElementById('drop');

  const FINISHES = [
    { key: 'gold', label: 'Gold', color: '#d4a017' },
    { key: 'silver', label: 'Silver', color: '#c0c4cc' },
    { key: 'copper', label: 'Copper', color: '#b8622e' },
    { key: 'antique-gold', label: 'Antique Gold', color: '#9a7a2a' },
    { key: 'antique-silver', label: 'Antique Silver', color: '#8f949a' },
    { key: 'black-nickel', label: 'Black Nickel', color: '#3f444b' },
  ];
  const SIZES = ['1.5', '1.75', '2', '2.5', '3'];
  const QUANTITIES = [50, 100, 250, 500];

  // Server config (pricing / payments availability)
  const config = { pricing: false, payments: false };
  fetch('/api/config').then((r) => r.json()).then((c) => Object.assign(config, c)).catch(() => {});

  // Conversation state
  const state = {
    step: 'await-image',
    file: null,
    previewUrl: null,
    finish: null,
    notes: '',
    coinCount: 0,
    busy: false,
    lastImage: null,
    order: null,
  };

  // ---------- helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const scrollDown = () => { chat.scrollTop = chat.scrollHeight; };

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function addMessage(role, contentNode) {
    const m = el('div', `msg ${role}`);
    m.appendChild(el('div', 'avatar'));
    const b = el('div', 'bubble');
    if (typeof contentNode === 'string') b.innerHTML = contentNode;
    else b.appendChild(contentNode);
    m.appendChild(b);
    chat.appendChild(m);
    scrollDown();
    return b;
  }

  async function botSay(html, delay = 550) {
    const bubble = addMessage('bot', '<span class="typing"><i></i><i></i><i></i></span>');
    await sleep(delay);
    bubble.innerHTML = html;
    scrollDown();
    return bubble;
  }

  function userSay(html) { return addMessage('user', html); }

  // Bot message that ends with an "Upload Your Image" button
  async function botAskForImage(introHtml, delay) {
    const wrap = el('div');
    wrap.innerHTML = introHtml;
    const actions = el('div', 'actions');
    const up = el('button', 'btn', 'Upload Your Image');
    up.type = 'button';
    up.addEventListener('click', () => fileInput.click());
    actions.appendChild(up);
    wrap.appendChild(actions);
    const bubble = await botSay('', delay);
    bubble.appendChild(wrap);
    scrollDown();
    return bubble;
  }

  function setChips(list) {
    chips.innerHTML = '';
    for (const c of list) {
      const b = el('button', 'chip' + (c.primary ? ' primary' : ''));
      b.type = 'button';
      if (c.color) {
        const s = el('span', 'swatch');
        s.style.background = c.color;
        b.appendChild(s);
      }
      b.appendChild(document.createTextNode(c.label));
      b.addEventListener('click', () => { setChips([]); c.onClick(); });
      chips.appendChild(b);
    }
    scrollDown();
  }

  function finishLabel(key) {
    const f = FINISHES.find((x) => x.key === key);
    return f ? f.label : 'Gold';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ---------- design flow ----------
  async function start() {
    chat.innerHTML = '';
    setChips([]);
    Object.assign(state, { step: 'await-image', file: null, previewUrl: null, finish: null, notes: '', busy: false, lastImage: null, order: null });
    await botAskForImage(
      '<p class="head"><span class="script">Welcome</span> to the Coin Builder</p>' +
      '<p>Send me the image of the coin you\'d like to generate, please. A logo, artwork, or sketch works great.</p>' +
      '<p>Tap the button below, or drag and drop a file anywhere in this chat.</p>',
      400
    );
    textInput.placeholder = 'Upload your image to get started…';
  }

  async function receiveImage(file) {
    if (state.busy) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      await botSay('<p>That file type won\'t work. Please send a <strong>PNG</strong>, <strong>JPG</strong>, or <strong>WEBP</strong> image.</p>');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      await botSay('<p>That image is a bit large. Please keep it under <strong>10 MB</strong>.</p>');
      return;
    }
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.file = file;
    state.previewUrl = URL.createObjectURL(file);
    state.order = null;

    const wrap = el('div');
    const img = el('img');
    img.src = state.previewUrl;
    img.alt = 'Your uploaded image';
    wrap.appendChild(img);
    wrap.appendChild(el('div', 'caption', escapeHtml(file.name)));
    userSay(wrap);

    await askFinish();
  }

  const finishChips = () => FINISHES.map((f) => ({ label: f.label, color: f.color, onClick: () => chooseFinish(f.key) }));

  async function askFinish() {
    state.step = 'await-finish';
    await botSay('<p>Nice! Which <strong>metal finish</strong> would you like for your coin?</p>');
    textInput.placeholder = 'Pick a finish above, or type one…';
    setChips(finishChips());
  }

  async function chooseFinish(key) {
    state.finish = key;
    userSay(`<p>${finishLabel(key)}</p>`);
    await askNotes();
  }

  async function askNotes() {
    state.step = 'await-notes';
    await botSay('<p>Any extra details? For example: <em>"add the text EST. 2024 around the rim"</em> or <em>"make the background textured"</em>.</p><p>Or just tell me to go ahead.</p>');
    textInput.placeholder = 'Type details, or tap "Generate my coin"';
    setChips([{ label: 'Generate My Coin', primary: true, onClick: () => generate() }]);
  }

  async function generate() {
    if (state.busy || !state.file) return;
    state.busy = true;
    state.step = 'generating';
    sendBtn.disabled = true;
    setChips([]);
    textInput.placeholder = 'Working on it…';

    const bubble = await botSay(`<p>Minting your <strong>${finishLabel(state.finish)}</strong> coin now… this usually takes 20–40 seconds.</p><p><span class="typing"><i></i><i></i><i></i></span></p>`, 300);

    const form = new FormData();
    form.append('image', state.file);
    form.append('finish', state.finish || 'gold');
    form.append('notes', state.notes || '');

    try {
      const res = await fetch('/api/generate', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Generation failed');

      state.coinCount += 1;
      state.lastImage = data.image;
      const wrap = el('div');
      wrap.appendChild(el('p', 'head', `<span class="script">Your</span> ${finishLabel(state.finish)} Coin`));
      wrap.appendChild(el('p', null, 'Here it is. The Quality is Always Here.'));
      const img = el('img');
      img.src = data.image;
      img.alt = 'Generated coin';
      wrap.appendChild(img);
      const actions = el('div', 'actions');
      const dl = el('a', 'btn small', 'Download');
      dl.href = data.image;
      dl.download = `coin-${state.finish}-${state.coinCount}.${data.image.startsWith('data:image/svg') ? 'svg' : 'png'}`;
      actions.appendChild(dl);
      wrap.appendChild(actions);
      if (data.provider === 'demo') {
        wrap.appendChild(el('div', 'caption', 'Demo mode: add an API key on the server to get AI-rendered coins.'));
      }
      bubble.innerHTML = '';
      bubble.appendChild(wrap);
      scrollDown();

      await offerNext();
    } catch (e) {
      bubble.innerHTML = `<p>${escapeHtml(e.message || 'Something went wrong.')}</p>`;
      state.step = 'done';
      setChips([
        { label: 'Try Again', primary: true, onClick: () => generate() },
        { label: 'Use a Different Image', onClick: () => restartForNewImage() },
      ]);
    } finally {
      state.busy = false;
      sendBtn.disabled = false;
    }
  }

  async function offerNext() {
    state.step = 'done';
    await botSay('<p>What do you think? If you love it, tap <strong>I Want This Coin Made</strong> and we\'ll get the details. Or edit it first.</p>');
    textInput.placeholder = 'Choose an option above…';
    setChips([
      { label: 'I Want This Coin Made', primary: true, onClick: () => startOrder() },
      { label: 'Edit This Coin', onClick: () => askEdit() },
      { label: 'Start a New Coin', onClick: () => restartForNewImage() },
    ]);
  }

  async function askEdit() {
    state.step = 'edit-menu';
    await botSay('<p>No problem. What would you like to change?</p>');
    setChips([
      { label: 'Try Another Finish', onClick: () => askFinish() },
      { label: 'Tweak the Design', onClick: () => askTweak() },
      { label: 'Upload a Different Image', onClick: () => restartForNewImage() },
    ]);
  }

  async function askTweak() {
    state.step = 'await-tweak';
    await botSay('<p>Sure. Tell me what to change and I\'ll re-render it.</p>');
    textInput.placeholder = 'e.g. "make the text bigger and add a star border"';
    textInput.focus();
  }

  async function restartForNewImage() {
    state.step = 'await-image';
    state.file = null;
    state.finish = null;
    state.notes = '';
    state.order = null;
    await botAskForImage('<p>Great! Send me the next image you\'d like to turn into a coin.</p>');
    textInput.placeholder = 'Upload your next image…';
  }

  // ---------- order flow ----------
  async function startOrder() {
    state.order = { quantity: null, size: null, name: '', email: '', phone: '', company: '', street: '', cityStateZip: '', country: '' };
    state.step = 'order-qty';
    await botSay('<p class="head"><span class="script">Great</span> choice!</p><p>How many coins would you like to order? Pick a quantity or type a number.</p>');
    textInput.placeholder = 'Type a quantity…';
    setChips(QUANTITIES.map((q) => ({ label: `${q} Coins`, onClick: () => chooseQuantity(q) })));
  }

  async function chooseQuantity(q) {
    state.order.quantity = q;
    userSay(`<p>${q} coins</p>`);
    await askSize();
  }

  async function askSize() {
    state.step = 'order-size';
    await botSay('<p>What <strong>size</strong> would you like? Most challenge coins are 1.75" or 2".</p>');
    textInput.placeholder = 'Pick a size above…';
    setChips(SIZES.map((s) => ({ label: `${s}"`, primary: s === '1.75', onClick: () => chooseSize(s) })));
  }

  async function chooseSize(s) {
    state.order.size = s;
    userSay(`<p>${s}"</p>`);
    await showEstimate();
  }

  async function showEstimate() {
    const o = state.order;
    if (config.pricing) {
      try {
        const r = await fetch(`/api/quote?size=${encodeURIComponent(o.size)}&quantity=${o.quantity}`);
        const d = await r.json();
        if (d.estimate) {
          o.estimate = d.estimate;
          await botSay(`<p>Your estimate for <strong>${o.quantity} × ${o.size}" ${finishLabel(state.finish)}</strong> coins:</p><p class="head">${money(d.estimate.total)} <span style="font-size:13px;letter-spacing:1px;color:#777">(${money(d.estimate.unit)} each)</span></p><p class="caption">Shipping and any setup fees are confirmed by our team.</p>`);
        }
      } catch (_) {}
    } else {
      await botSay('<p>Perfect. Our team will confirm exact pricing with you by email, usually within one business day.</p>');
    }
    await askName();
  }

  async function askName() {
    state.step = 'order-name';
    await botSay('<p>Now a few details so we can get this to you. What\'s your <strong>name</strong>?</p>');
    textInput.placeholder = 'Your name';
    textInput.focus();
  }

  async function askEmail() {
    state.step = 'order-email';
    await botSay(`<p>Thanks, ${escapeHtml(state.order.name.split(' ')[0])}. What <strong>email address</strong> should we use?</p>`);
    textInput.placeholder = 'you@example.com';
    textInput.focus();
  }

  async function askPhone() {
    state.step = 'order-phone';
    await botSay('<p>And a <strong>phone number</strong>, in case our team has a quick question? You can skip this.</p>');
    textInput.placeholder = 'Phone number (optional)';
    setChips([{ label: 'Skip', onClick: () => { userSay('<p>Skip</p>'); askCompany(); } }]);
    textInput.focus();
  }

  async function askCompany() {
    state.step = 'order-company';
    await botSay('<p>Is this for a <strong>company, unit, or organization</strong>? Type the name, or skip.</p>');
    textInput.placeholder = 'Company / organization (optional)';
    setChips([{ label: 'Skip', onClick: () => { userSay('<p>Skip</p>'); askStreet(); } }]);
    textInput.focus();
  }

  async function askStreet() {
    state.step = 'order-street';
    await botSay('<p>Where should we <strong>ship</strong> your coins? Start with the street address.</p>');
    textInput.placeholder = 'Street address, suite / unit';
    textInput.focus();
  }

  async function askCityStateZip() {
    state.step = 'order-city';
    await botSay('<p>City, state and ZIP? For example: <em>Austin, TX 78701</em></p>');
    textInput.placeholder = 'City, State ZIP';
    textInput.focus();
  }

  async function askCountry() {
    state.step = 'order-country';
    await botSay('<p>And the <strong>country</strong>?</p>');
    textInput.placeholder = 'Country';
    setChips([
      { label: 'United States', primary: true, onClick: () => chooseCountry('United States') },
      { label: 'Canada', onClick: () => chooseCountry('Canada') },
    ]);
    textInput.focus();
  }

  async function chooseCountry(c) {
    state.order.country = c;
    userSay(`<p>${escapeHtml(c)}</p>`);
    await reviewOrder();
  }

  async function reviewOrder() {
    const o = state.order;
    state.step = 'order-review';
    const rows = [
      ['Coin', `${finishLabel(state.finish)}, ${o.size}"`],
      ['Quantity', String(o.quantity)],
      o.estimate ? ['Estimate', `${money(o.estimate.total)} (${money(o.estimate.unit)} each)`] : null,
      ['Name', escapeHtml(o.name)],
      ['Email', escapeHtml(o.email)],
      o.phone ? ['Phone', escapeHtml(o.phone)] : null,
      o.company ? ['Company', escapeHtml(o.company)] : null,
      ['Ship to', `${escapeHtml(o.street)}<br>${escapeHtml(o.cityStateZip)}<br>${escapeHtml(o.country)}`],
      state.notes ? ['Notes', escapeHtml(state.notes)] : null,
    ].filter(Boolean);

    const wrap = el('div');
    wrap.appendChild(el('p', 'head', '<span class="script">Review</span> your order'));
    const img = el('img');
    img.src = state.lastImage;
    img.alt = 'Your coin';
    img.style.width = '200px';
    wrap.appendChild(img);
    const table = el('table', 'summary');
    for (const [k, v] of rows) table.appendChild(el('tr', null, `<th>${k}</th><td>${v}</td>`));
    wrap.appendChild(table);
    const bubble = await botSay('');
    bubble.appendChild(wrap);
    scrollDown();

    const payLabel = config.payments && o.estimate ? 'Pay Now' : 'Send to Coins for Anything';
    textInput.placeholder = 'Confirm above, or type a change…';
    setChips([
      { label: payLabel, primary: true, onClick: () => submitOrder() },
      { label: 'Change Quantity', onClick: () => startOrder() },
      { label: 'Change Shipping', onClick: () => askStreet() },
      { label: 'Cancel', onClick: () => { userSay('<p>Cancel</p>'); offerNext(); } },
    ]);
  }

  async function submitOrder() {
    if (state.busy) return;
    state.busy = true;
    sendBtn.disabled = true;
    const o = state.order;
    const bubble = await botSay('<p>Sending your order… <span class="typing"><i></i><i></i><i></i></span></p>', 200);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finish: state.finish,
          size: o.size,
          quantity: o.quantity,
          name: o.name,
          email: o.email,
          phone: o.phone,
          company: o.company,
          street: o.street,
          cityStateZip: o.cityStateZip,
          country: o.country,
          notes: state.notes,
          image: state.lastImage,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not place order');

      if (data.checkoutUrl) {
        bubble.innerHTML = `<p>Order <strong>${escapeHtml(data.orderId)}</strong> is ready. Taking you to secure checkout…</p>`;
        await sleep(800);
        window.location.href = data.checkoutUrl;
        return;
      }

      bubble.innerHTML =
        `<p class="head"><span class="script">Thank you</span> so much for your business!</p>` +
        `<p>Your coin request <strong>${escapeHtml(data.orderId)}</strong> has been sent to the <strong>Coins for Anything team for review</strong>. ` +
        `We\'ll be in touch at <strong>${escapeHtml(o.email)}</strong> ` +
        (o.estimate ? 'with your invoice and next steps' : 'with pricing and next steps') +
        ' within one business day.</p>' +
        '<p>The Quality is Always Here.</p>';
      state.step = 'ordered';
      setChips([
        { label: 'Make Another Coin', primary: true, onClick: () => restartForNewImage() },
      ]);
    } catch (e) {
      bubble.innerHTML = `<p>${escapeHtml(e.message)}</p>`;
      setChips([
        { label: 'Try Again', primary: true, onClick: () => submitOrder() },
        { label: 'Edit Details', onClick: () => askName() },
      ]);
    } finally {
      state.busy = false;
      sendBtn.disabled = false;
    }
  }

  // Returning from Stripe Checkout
  async function handleReturnFromCheckout() {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order');
    if (!orderId) return false;
    const paid = params.get('paid') === '1';
    history.replaceState(null, '', window.location.pathname);
    fetch(`/api/orders/${encodeURIComponent(orderId)}/paid`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paid }),
    }).catch(() => {});
    chat.innerHTML = '';
    if (paid) {
      await botSay(`<p class="head"><span class="script">Thank you</span> for your order!</p><p>Payment received for order <strong>${escapeHtml(orderId)}</strong>. A receipt is on its way to your inbox, and our team will be in touch about production and shipping.</p>`, 300);
    } else {
      await botSay(`<p>Checkout was cancelled for order <strong>${escapeHtml(orderId)}</strong>. No charge was made. Our team still has your quote request and will follow up by email.</p>`, 300);
    }
    state.step = 'await-image';
    setChips([{ label: 'Make Another Coin', primary: true, onClick: () => restartForNewImage() }]);
    return true;
  }

  // ---------- text handling ----------
  function parseFinish(text) {
    const t = text.toLowerCase();
    const order = ['antique-gold', 'antique-silver', 'black-nickel', 'gold', 'silver', 'copper'];
    for (const key of order) {
      const f = FINISHES.find((x) => x.key === key);
      if (t.includes(f.label.toLowerCase()) || t.includes(key)) return key;
    }
    if (/\bbronze\b/.test(t)) return 'copper';
    return null;
  }

  function parseQuantity(text) {
    const m = text.replace(/,/g, '').match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  function parseSize(text) {
    const m = text.match(/(\d+(?:\.\d+)?)/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return SIZES.find((s) => parseFloat(s) === n) || null;
  }

  async function handleText(text) {
    userSay(`<p>${escapeHtml(text)}</p>`);
    const raw = text.trim();
    const t = raw.toLowerCase();

    if (/^(restart|start over|reset)$/.test(t)) return start();

    switch (state.step) {
      case 'await-image':
        await botAskForImage('<p>I just need your image to get started.</p>');
        break;

      case 'await-finish': {
        const f = parseFinish(t);
        if (f) { state.finish = f; setChips([]); await askNotes(); }
        else {
          await botSay('<p>I didn\'t catch that finish. Pick one of the options above.</p>');
          setChips(finishChips());
        }
        break;
      }

      case 'await-notes':
        if (/^(go|go ahead|ok|okay|yes|generate|no|none|nope|skip|proceed|do it)[.!]?$/.test(t)) {
          await generate();
        } else {
          state.notes = raw;
          setChips([]);
          await botSay(`<p>Got it: <em>${escapeHtml(state.notes)}</em></p>`);
          await generate();
        }
        break;

      case 'await-tweak':
        state.notes = raw;
        await generate();
        break;

      case 'done':
      case 'edit-menu': {
        const f = parseFinish(t);
        if (/order|buy|purchase|pay|want|make it|love/.test(t)) { setChips([]); await startOrder(); }
        else if (f) { state.finish = f; setChips([]); await generate(); }
        else if (/another|new image|different image|next/.test(t)) { setChips([]); await restartForNewImage(); }
        else if (/edit|change|tweak/.test(t) && state.step === 'done') { setChips([]); await askEdit(); }
        else { state.notes = raw; setChips([]); await generate(); }
        break;
      }

      case 'order-qty': {
        const q = parseQuantity(raw);
        if (q && q > 0 && q <= 100000) { state.order.quantity = q; setChips([]); await askSize(); }
        else { await botSay('<p>Please enter a number of coins, for example <strong>100</strong>.</p>'); }
        break;
      }

      case 'order-size': {
        const s = parseSize(raw);
        if (s) { state.order.size = s; setChips([]); await showEstimate(); }
        else { await botSay(`<p>Please pick one of these sizes: ${SIZES.map((x) => x + '"').join(', ')}.</p>`); }
        break;
      }

      case 'order-name':
        if (raw.length < 2) { await botSay('<p>Please enter your name.</p>'); break; }
        state.order.name = raw;
        await askEmail();
        break;

      case 'order-email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) { await botSay('<p>That doesn\'t look like an email address. Please try again.</p>'); break; }
        state.order.email = raw;
        await askPhone();
        break;

      case 'order-phone':
        state.order.phone = /^(skip|no|none)$/.test(t) ? '' : raw;
        setChips([]);
        await askCompany();
        break;

      case 'order-company':
        state.order.company = /^(skip|no|none|n\/a)$/.test(t) ? '' : raw;
        setChips([]);
        await askStreet();
        break;

      case 'order-street':
        if (raw.length < 4) { await botSay('<p>Please enter the street address.</p>'); break; }
        state.order.street = raw;
        await askCityStateZip();
        break;

      case 'order-city':
        if (raw.length < 3) { await botSay('<p>Please enter the city, state and ZIP.</p>'); break; }
        state.order.cityStateZip = raw;
        await askCountry();
        break;

      case 'order-country':
        if (raw.length < 2) { await botSay('<p>Please enter the country.</p>'); break; }
        state.order.country = raw;
        setChips([]);
        await reviewOrder();
        break;

      case 'order-review':
        if (/^(yes|confirm|place order|pay|ok|okay)[.!]?$/.test(t)) { setChips([]); await submitOrder(); }
        else if (/quantity|qty|how many/.test(t) || parseQuantity(raw)) { setChips([]); await startOrder(); }
        else if (/ship|address/.test(t)) { setChips([]); await askStreet(); }
        else if (/cancel|back/.test(t)) { setChips([]); await offerNext(); }
        else { await botSay('<p>Tap <strong>Place Order</strong> to confirm, or choose what to change.</p>'); }
        break;

      case 'ordered':
        if (/another|new|again/.test(t)) { setChips([]); await restartForNewImage(); }
        else { await botSay('<p>Your order is in. Want to make another coin?</p>'); setChips([{ label: 'Make Another Coin', primary: true, onClick: () => restartForNewImage() }]); }
        break;

      case 'generating':
        await botSay('<p>Hang tight, still working on your coin…</p>');
        break;
    }
  }

  // ---------- events ----------
  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = textInput.value;
    textInput.value = '';
    if (!text.trim()) { if (state.step === 'await-image') fileInput.click(); return; }
    handleText(text);
  });

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (f) receiveImage(f);
  });

  restartBtn.addEventListener('click', start);

  // Drag & drop
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; drop.hidden = false; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.hidden = true; });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0; drop.hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) receiveImage(f);
  });

  // Paste an image from clipboard
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) { receiveImage(it.getAsFile()); break; }
    }
  });

  handleReturnFromCheckout().then((handled) => { if (!handled) start(); });
})();
