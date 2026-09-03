'use strict';

const { buildPrompt, finishLabel } = require('./prompt');
const { pickReferences } = require('./references');

/**
 * Each provider receives { buffer, mimetype, finish, notes } and resolves to
 * { mimetype, base64 } for the generated coin image.
 */

async function openaiProvider({ buffer, mimetype, finish, notes }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  // Up to 16 images total per request: customer image + references
  const refs = pickReferences(finish, process.env.REFERENCE_COUNT || 4).slice(0, 15);

  const form = new FormData();
  form.append('model', process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1');
  form.append('prompt', buildPrompt({ finish, notes, referenceCount: refs.length }));
  form.append('size', process.env.OPENAI_IMAGE_SIZE || '1024x1024');
  form.append('quality', process.env.OPENAI_IMAGE_QUALITY || 'medium');
  form.append('n', '1');
  form.append('image[]', new Blob([buffer], { type: mimetype }), 'source.png');
  refs.forEach((r, i) => form.append('image[]', new Blob([r.buffer], { type: r.mimetype }), `ref-${i + 1}-${r.name}`));

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = (err && err.error && err.error.message) || JSON.stringify(err);
    } catch (_) {
      detail = await res.text();
    }
    throw new Error(`OpenAI image edit failed (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error('OpenAI returned no image data');
  return { mimetype: 'image/png', base64: b64 };
}

/**
 * Demo provider: no external calls. Wraps the uploaded image in an SVG coin
 * so the whole chat flow can be tested without an API key.
 */
async function demoProvider({ buffer, mimetype, finish }) {
  const palettes = {
    gold: ['#f8e27a', '#c9971c', '#7a5510'],
    silver: ['#f4f4f4', '#b9bcc2', '#6b6f75'],
    copper: ['#f2b58c', '#b8622e', '#6e3416'],
    'antique-gold': ['#d9c27a', '#9a7a2a', '#4a3810'],
    'antique-silver': ['#d7d9dc', '#8f949a', '#44484d'],
    'black-nickel': ['#8a8f96', '#3f444b', '#15181c'],
  };
  const [hi, mid, lo] = palettes[finish] || palettes.gold;
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
  return { mimetype: 'image/svg+xml', base64: Buffer.from(svg).toString('base64') };
}

const providers = { openai: openaiProvider, demo: demoProvider };

function getProvider() {
  const name = (process.env.IMAGE_PROVIDER || 'openai').toLowerCase();
  if (name === 'openai' && !process.env.OPENAI_API_KEY) {
    return { name: 'demo', generate: providers.demo };
  }
  const fn = providers[name];
  if (!fn) throw new Error(`Unknown IMAGE_PROVIDER "${name}"`);
  return { name, generate: fn };
}

module.exports = { getProvider };
