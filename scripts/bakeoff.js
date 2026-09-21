'use strict';

/**
 * npm run bakeoff -- <art-proof.png> "TOP TEXT" "BOTTOM TEXT" "CENTER TEXT" [model[:quality[:size]],...]
 * Costs real renders. Sends the same art proof and prompt to each model, proofreads every result, and writes
 * a side-by-side page to ./bakeoff-results/index.html. This is how to decide whether a new model is really better
 * for coins, instead of trusting a leaderboard.
 *
 * To get an art proof exactly as the app sends it, start the server with DEBUG_PROOF_DIR=some/folder and render once.
 * BAKEOFF_FINISH=shiny-gold picks the plating, BAKEOFF_NO_LOGO=1 says the proof has no logo.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { buildPrompt, normalizeTexts } = require('../lib/prompt');
const { verifyRender } = require('../lib/verify');
const { pickReferences } = require('../lib/references');
const { MODEL_LADDER, editImage } = require('../lib/providers');

const [proofPath, top, bottom, center, list] = process.argv.slice(2);
if (!proofPath || !fs.existsSync(proofPath)) {
  console.error('Usage: npm run bakeoff -- <art-proof.png> "TOP" "BOTTOM" "CENTER" [model[:quality[:size]],...]');
  process.exit(1);
}

const contenders = (list || `${MODEL_LADDER[0]}:high:1024x1024,${MODEL_LADDER[0]}:high:2048x2048`).split(',').map((c) => {
  const [model, quality = 'high', size = '1024x1024'] = c.trim().split(':');
  return { model, quality, size };
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

(async () => {
  const apiKey = process.env.OPENAI_API_KEY;
  const buffer = fs.readFileSync(proofPath);
  const texts = normalizeTexts({ top, bottom, center });
  const hasLogo = process.env.BAKEOFF_NO_LOGO !== '1';
  const refs = pickReferences('', 2); // the same two photos for every contender
  const prompt = buildPrompt({ finish: process.env.BAKEOFF_FINISH || 'antique-silver', texts, hasLogo, referenceCount: refs.length });
  const outDir = path.join(process.cwd(), 'bakeoff-results');
  fs.mkdirSync(outDir, { recursive: true });

  const rows = [];
  for (const [i, c] of contenders.entries()) {
    if (i) await sleep(65000); // stay under the per-minute image limit of a new OpenAI account
    process.env.OPENAI_IMAGE_QUALITY = c.quality;
    process.env.OPENAI_IMAGE_SIZE = c.size;
    const started = Date.now();
    try {
      const b64 = await editImage({ apiKey, model: c.model, prompt, buffer, mimetype: 'image/png', refs });
      const seconds = Math.round((Date.now() - started) / 1000);
      const file = `${i + 1}-${c.model}-${c.quality}-${c.size}.png`;
      fs.writeFileSync(path.join(outDir, file), Buffer.from(b64, 'base64'));
      const check = await verifyRender({ apiKey, guide: `data:image/png;base64,${buffer.toString('base64')}`, render: `data:image/png;base64,${b64}`, texts, hasLogo });
      rows.push({ ...c, seconds, file, check });
      console.log(`${c.model} ${c.quality} ${c.size}: ${seconds}s, proofreading ${check.ok ? 'passed' : 'FLAGGED: ' + check.feedback}`);
    } catch (e) {
      rows.push({ ...c, error: e.message });
      console.log(`${c.model} ${c.quality} ${c.size}: ${e.message}`);
    }
  }

  const card = (r) => (r.error
    ? `<figure><figcaption><b>${esc(r.model)}</b> ${esc(r.quality)} ${esc(r.size)}<br><span class="bad">${esc(r.error)}</span></figcaption></figure>`
    : `<figure><img src="${esc(r.file)}"><figcaption><b>${esc(r.model)}</b> · ${esc(r.quality)} · ${esc(r.size)} · ${r.seconds}s<br>`
      + `<span class="${r.check.ok ? 'ok' : 'bad'}">${r.check.ok ? 'Passed proofreading' : 'Flagged: ' + esc(r.check.feedback)}</span>`
      + `${r.check.logoMatch != null ? `<br>Logo match ${r.check.logoMatch}/10` : ''}</figcaption></figure>`);
  const html = `<!doctype html><meta charset="utf-8"><title>Coin render bake-off</title>
<style>body{font:15px system-ui;background:#151515;color:#eee;margin:24px}h1{font-weight:600}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:20px}
figure{margin:0;background:#222;padding:12px}img{width:100%;display:block}figcaption{padding-top:10px;line-height:1.5}.ok{color:#81c784}.bad{color:#ffb74d}</style>
<h1>Coin render bake-off, ${new Date().toISOString().slice(0, 10)}</h1>
<p>Same art proof, same prompt, same reference photos. Always judge by eye as well: the proofreader is strict, not perfect.</p>
<div class="grid">
<figure><img src="data:image/png;base64,${buffer.toString('base64')}"><figcaption><b>The art proof</b><br>What every model was given</figcaption></figure>
${rows.map(card).join('\n')}
</div>`;
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  console.log(`\nOpen ${path.join(outDir, 'index.html')}`);
})();
