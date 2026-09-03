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

  // Conversation state
  const state = {
    step: 'await-image', // await-image | await-finish | await-notes | generating | done
    file: null,
    previewUrl: null,
    finish: null,
    notes: '',
    coinCount: 0,
    busy: false,
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
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- flow ----------
  async function start() {
    chat.innerHTML = '';
    setChips([]);
    Object.assign(state, { step: 'await-image', file: null, previewUrl: null, finish: null, notes: '', busy: false });
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

    const wrap = el('div');
    const img = el('img');
    img.src = state.previewUrl;
    img.alt = 'Your uploaded image';
    wrap.appendChild(img);
    wrap.appendChild(el('div', 'caption', escapeHtml(file.name)));
    userSay(wrap);

    await askFinish();
  }

  async function askFinish() {
    state.step = 'await-finish';
    await botSay('<p>Nice! Which <strong>metal finish</strong> would you like for your coin?</p>');
    textInput.placeholder = 'Pick a finish above, or type one…';
    setChips(FINISHES.map((f) => ({ label: f.label, color: f.color, onClick: () => chooseFinish(f.key) })));
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
    await botSay('<p>What would you like to do next?</p>');
    textInput.placeholder = 'Choose an option above, or type a tweak…';
    setChips([
      { label: 'Try Another Finish', onClick: () => askFinish() },
      { label: 'Tweak This Coin', onClick: () => askTweak() },
      { label: 'Make Another Coin', primary: true, onClick: () => restartForNewImage() },
    ]);
  }

  async function askTweak() {
    state.step = 'await-notes';
    await botSay('<p>Sure. Tell me what to change and I\'ll re-render it.</p>');
    textInput.placeholder = 'e.g. "make the text bigger and add a star border"';
    textInput.focus();
  }

  async function restartForNewImage() {
    state.step = 'await-image';
    state.file = null;
    state.finish = null;
    state.notes = '';
    await botAskForImage('<p>Great! Send me the next image you\'d like to turn into a coin.</p>');
    textInput.placeholder = 'Upload your next image…';
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

  async function handleText(text) {
    userSay(`<p>${escapeHtml(text)}</p>`);
    const t = text.trim().toLowerCase();

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
          setChips(FINISHES.map((x) => ({ label: x.label, color: x.color, onClick: () => chooseFinish(x.key) })));
        }
        break;
      }

      case 'await-notes':
        if (/^(go|go ahead|ok|okay|yes|generate|no|none|nope|skip|proceed|do it)[.!]?$/.test(t)) {
          await generate();
        } else {
          state.notes = text.trim();
          setChips([]);
          await botSay(`<p>Got it: <em>${escapeHtml(state.notes)}</em></p>`);
          await generate();
        }
        break;

      case 'done': {
        const f = parseFinish(t);
        if (f) { state.finish = f; setChips([]); await generate(); }
        else if (/another|new image|different image|next/.test(t)) { setChips([]); await restartForNewImage(); }
        else { state.notes = text.trim(); setChips([]); await generate(); }
        break;
      }

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
    if (!text.trim()) { fileInput.click(); return; }
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

  start();
})();
