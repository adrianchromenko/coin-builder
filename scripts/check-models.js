'use strict';

/**
 * npm run check-models
 * Free (no images are generated). Lists the image models this OpenAI key can use, newest first, and says
 * whether anything newer than the app's first choice has appeared. Run it monthly, or when OpenAI announces a model.
 */

require('dotenv').config();
const { MODEL_LADDER } = require('../lib/providers');

(async () => {
  if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY is not set in .env'); process.exit(1); }
  const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
  const data = await res.json();
  if (!res.ok) { console.error('OpenAI error:', data.error && data.error.message); process.exit(1); }

  const day = (m) => new Date(m.created * 1000).toISOString().slice(0, 10);
  // Dated snapshots (…-2026-09-08) are pinned copies of a model that is already listed
  const models = data.data.filter((m) => /image/i.test(m.id) && !/\d{4}-\d{2}-\d{2}$/.test(m.id)).sort((a, b) => b.created - a.created);
  const preferred = process.env.OPENAI_IMAGE_MODEL || MODEL_LADDER[0];
  const current = models.find((m) => m.id === preferred);

  console.log(`The app renders with: ${preferred}${current ? ` (released ${day(current)})` : ' (NOT available to this key: the app is falling back to an older model)'}\n`);
  console.log('Image models available to this key, newest first:');
  for (const m of models) console.log(`  ${day(m)}  ${m.id}${m.id === preferred ? '   <- in use' : ''}`);

  // Same-day siblings (flare / sunburst) are variants of one release, not something newer
  const newer = current ? models.filter((m) => m.created > current.created + 86400 && !/mini|latest/i.test(m.id)) : [];
  if (newer.length) {
    console.log(`\nNewer than what the app uses: ${newer.map((m) => m.id).join(', ')}`);
    console.log(`Compare before switching:  npm run bakeoff -- <art-proof.png> "TOP TEXT" "BOTTOM TEXT" "CENTER TEXT" ${preferred},${newer[0].id}`);
  } else {
    console.log('\nNothing newer is available. You are on the newest model.');
  }
})();
