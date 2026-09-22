'use strict';

const { buildPrompt, finishLabel, normalizeFinish, normalizeTexts } = require('./prompt');
const { pickReferences } = require('./references');
const { verifyRender } = require('./verify');

/**
 * Each provider receives { buffer, mimetype, finish, color, shape, addons, texts, hasLogo, border }
 * and resolves to { mimetype, base64, check, attempts, model } for the generated coin image.
 */

// Newest first. Lettering and logo fidelity improved a lot with every generation, so the
// best model the account can use is always tried first; older ones are only a safety net.
const MODEL_LADDER = ['gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-1.5', 'gpt-image-1'];
let workingModel = null; // remembered after the first success so fallbacks are not re-tried on every render

function modelPlan() {
  const preferred = process.env.OPENAI_IMAGE_MODEL;
  const ladder = preferred ? [preferred, ...MODEL_LADDER.slice(Math.max(0, MODEL_LADDER.indexOf(preferred) + 1))] : MODEL_LADDER;
  const list = workingModel ? [workingModel, ...ladder] : ladder;
  return [...new Set(list)];
}

async function editImage({ apiKey, model, prompt, buffer, mimetype, refs }) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('size', process.env.OPENAI_IMAGE_SIZE || '1024x1024');
  form.append('quality', process.env.OPENAI_IMAGE_QUALITY || 'high');
  form.append('n', '1');
  // The first-generation models only keep fine detail from the input (logos, lettering) when asked to
  if (/^gpt-image-1(\.5)?$/.test(model)) form.append('input_fidelity', 'high');
  // The customer's art proof always goes first: it is the image the model stays most faithful to
  form.append('image[]', new Blob([buffer], { type: mimetype }), 'art-proof.png');
  refs.forEach((r, i) => form.append('image[]', new Blob([r.buffer], { type: r.mimetype }), `factory-coin-${i + 1}${r.ext}`));

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(240000),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = (err && err.error && err.error.message) || JSON.stringify(err);
    } catch (_) {
      detail = await res.text().catch(() => '');
    }
    const e = new Error(`OpenAI image edit failed (${res.status}, ${model}): ${detail}`);
    e.status = res.status;
    throw e;
  }
  const data = await res.json();
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error('OpenAI returned no image data');
  return b64;
}

// OpenAI limits image requests per minute (new accounts: 5 input images a minute, and every render sends the art
// proof plus the reference photos). A 429 says how long to wait, so wait and go again instead of failing the customer.
async function withRateLimitRetry(call, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await call();
    } catch (e) {
      if (e.status !== 429 || i >= tries || /quota|billing/i.test(e.message)) throw e;
      const asked = /try again in ([\d.]+)\s*s/i.exec(e.message);
      const seconds = Math.min(45, (asked ? parseFloat(asked[1]) : 15) + 2);
      console.warn(`[coin-builder] OpenAI rate limit reached, waiting ${Math.round(seconds)}s (raise the account's image limits if this shows up often)`);
      await new Promise((r) => setTimeout(r, seconds * 1000));
    }
  }
}

// One render, walking down the model ladder only when the API rejects the request itself
async function renderOnce(args) {
  let lastError;
  for (const model of modelPlan()) {
    try {
      const b64 = await withRateLimitRetry(() => editImage({ ...args, model }));
      if (workingModel !== model) console.log(`[coin-builder] rendering with ${model}`);
      workingModel = model;
      return { b64, model };
    } catch (e) {
      lastError = e;
      // 400/403/404: this model, or a setting it does not accept. Anything else (rate limit, outage, moderation) is not fixed by switching.
      if (![400, 403, 404].includes(e.status) || /safety|moderation|content policy/i.test(e.message)) throw e;
      console.warn(`[coin-builder] ${e.message}; trying the next model`);
      if (workingModel === model) workingModel = null;
    }
  }
  throw lastError;
}

async function openaiProvider({ buffer, mimetype, finish, color, shape, addons, texts, hasLogo, border, background, centerFirstLineWords }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  texts = normalizeTexts(texts);

  // A couple of factory photos are enough to set the style; more of them only adds other coins' lettering to compete with the customer's
  const refCount = Math.min(Number(process.env.REFERENCE_COUNT ?? 2) || 0, 3);
  const refs = pickReferences(normalizeFinish(finish), refCount);
  const guide = `data:${mimetype};base64,${buffer.toString('base64')}`;
  const maxAttempts = Math.max(1, Math.min(3, Number(process.env.AI_MAX_ATTEMPTS || 2)));
  const proofread = process.env.AI_VERIFY !== '0';

  let best = null;
  let feedback = '';
  let attempts = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildPrompt({ finish, color, shape, addons, texts, hasLogo, border, background, centerFirstLineWords, referenceCount: refs.length, feedback });
    const { b64, model } = await renderOnce({ apiKey, prompt, buffer, mimetype, refs });
    attempts = attempt;
    const check = proofread
      ? await verifyRender({ apiKey, guide, render: `data:image/png;base64,${b64}`, texts, hasLogo, border })
      : { checked: false, ok: false, score: 0, lines: [], extraText: [], logoMatch: null, logoIssues: '', borderOk: null, feedback: '' };
    if (check.checked) console.log(`[coin-builder] attempt ${attempt}: ${check.ok ? 'passed proofreading' : 'failed proofreading: ' + check.feedback}`);
    if (!best || check.score > best.check.score) best = { b64, model, check };
    if (!check.checked || check.ok) break;
    feedback = check.feedback;
  }

  const { feedback: _internal, ...check } = best.check;
  return { mimetype: 'image/png', base64: best.b64, check, attempts, model: best.model };
}

/**
 * Demo provider: no external calls. Wraps the uploaded image in an SVG coin
 * so the whole chat flow can be tested without an API key.
 */
async function demoProvider({ buffer, mimetype, finish }) {
  const check = { checked: false, ok: false, lines: [], extraText: [], logoMatch: null, logoIssues: '' };
  const palettes = {
    'antique-brass': ['#cdb26a', '#8c6d2c', '#3f2f12'],
    'antique-copper': ['#c98f6b', '#8a4a26', '#3d1f10'],
    'shiny-copper': ['#f2b58c', '#b8622e', '#6e3416'],
    'antique-gold': ['#d9c27a', '#9a7a2a', '#4a3810'],
    'shiny-gold': ['#f8e27a', '#c9971c', '#7a5510'],
    'satin-gold': ['#ead79a', '#c4a550', '#8a6c28'],
    'antique-silver': ['#d7d9dc', '#8f949a', '#44484d'],
    'shiny-silver': ['#f4f4f4', '#b9bcc2', '#6b6f75'],
    'satin-silver': ['#e3e4e6', '#b4b7bb', '#7d8186'],
    'shiny-nickel': ['#ecebe6', '#aeada6', '#62615b'],
    'satin-nickel': ['#d9d8d2', '#a6a59e', '#706f69'],
    'black-nickel': ['#8a8f96', '#3f444b', '#15181c'],
  };
  const [hi, mid, lo] = palettes[normalizeFinish(finish)];
  const href = `data:${mimetype};base64,${buffer.toString('base64')}`;
  const label = finishLabel(finish).toUpperCase();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bg" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#3a3d44"/><stop offset="1" stop-color="#121317"/></radialGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="0.5" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/></linearGradient>
    <linearGradient id="metal2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="0.5" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/></linearGradient>
    <clipPath id="face"><circle cx="512" cy="512" r="340"/></clipPath>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity="0.7"/></filter>
    <filter id="inset"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <circle cx="512" cy="512" r="430" fill="url(#metal)" filter="url(#shadow)"/>
  <circle cx="512" cy="512" r="430" fill="none" stroke="${lo}" stroke-width="6" stroke-dasharray="4 6" opacity="0.8"/>
  <circle cx="512" cy="512" r="395" fill="url(#metal2)"/>
  <circle cx="512" cy="512" r="352" fill="${lo}" opacity="0.6" filter="url(#inset)"/>
  <circle cx="512" cy="512" r="340" fill="${mid}"/>
  <image href="${href}" xlink:href="${href}" x="172" y="172" width="680" height="680" preserveAspectRatio="xMidYMid meet" clip-path="url(#face)" opacity="0.92"/>
  <circle cx="512" cy="512" r="340" fill="none" stroke="${hi}" stroke-width="4" opacity="0.7"/>
  <text x="512" y="960" text-anchor="middle" font-family="Georgia, serif" font-size="30" letter-spacing="6" fill="${hi}" opacity="0.85">${label} - DEMO PREVIEW</text>
</svg>`;
  return { mimetype: 'image/svg+xml', base64: Buffer.from(svg).toString('base64'), check, attempts: 1, model: 'demo' };
}

/**
 * Fixture provider: IMAGE_PROVIDER=fixture with FIXTURE_IMAGE=path/to/render.png replays a saved render.
 * No API calls and no cost, but it goes through the same watermarking, storage and ordering path as a real render,
 * which makes it the right tool for testing that path and for demos.
 */
async function fixtureProvider() {
  const file = process.env.FIXTURE_IMAGE;
  if (!file || !require('fs').existsSync(file)) throw new Error('FIXTURE_IMAGE is not set or does not exist');
  const check = { checked: false, ok: false, lines: [], extraText: [], logoMatch: null, logoIssues: '' };
  return { mimetype: 'image/png', base64: require('fs').readFileSync(file).toString('base64'), check, attempts: 1, model: 'fixture' };
}

const providers = { openai: openaiProvider, demo: demoProvider, fixture: fixtureProvider };

function getProvider() {
  const name = (process.env.IMAGE_PROVIDER || 'openai').toLowerCase();
  if (name === 'openai' && !process.env.OPENAI_API_KEY) {
    return { name: 'demo', generate: providers.demo };
  }
  const fn = providers[name];
  if (!fn) throw new Error(`Unknown IMAGE_PROVIDER "${name}"`);
  return { name, generate: fn };
}

module.exports = { getProvider, MODEL_LADDER, editImage };
