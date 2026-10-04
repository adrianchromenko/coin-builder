'use strict';

const crypto = require('crypto');

/**
 * Screens what a customer uploads (their logo and reference images) before any of it is sent to the image model.
 * Every image is read by OpenAI's moderation model, which costs nothing per call. An image that comes back flagged
 * stops the render, and the customer is told which file to take out.
 *
 * What is blocked: sexual content, gore and self-harm. Plain "violence" is NOT blocked: coins for military and police
 * units carry weapons, skulls and battle scenes as a matter of course, and refusing those would refuse real customers.
 *
 * If the moderation service itself cannot be reached, the upload is let through and the miss is logged: the image
 * model refuses that kind of content on its own, so an outage here should not stop customers from rendering coins.
 */
const MODEL = () => process.env.MODERATION_MODEL || 'omni-moderation-latest';
const BLOCKED = ['sexual', 'sexual/minors', 'violence/graphic', 'self-harm', 'self-harm/intent', 'self-harm/instructions'];
const enabled = () => process.env.MODERATE_UPLOADS !== '0' && !!process.env.OPENAI_API_KEY;

// The same file comes back with every new version of a coin; its verdict is remembered so it is read only once
const MAX_REMEMBERED = 500;
const verdicts = new Map(); // sha256 of the file -> '' (clean) or the category that flagged it

async function screenOne(apiKey, image) {
  const key = crypto.createHash('sha256').update(image.buffer).digest('hex');
  if (verdicts.has(key)) return verdicts.get(key);
  const res = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL(),
      input: [{ type: 'image_url', image_url: { url: `data:${image.mimetype};base64,${image.buffer.toString('base64')}` } }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`moderation failed (${res.status}): ${(data.error && data.error.message) || 'no detail'}`);
  const categories = (data.results && data.results[0] && data.results[0].categories) || {};
  const hit = BLOCKED.find((c) => categories[c] === true) || '';
  verdicts.set(key, hit);
  while (verdicts.size > MAX_REMEMBERED) verdicts.delete(verdicts.keys().next().value);
  return hit;
}

/**
 * images: [{ buffer, mimetype, label }]. Resolves to the images that must not be used, as [{ label, category }];
 * an empty list means everything is fine (or screening is switched off).
 */
async function screenUploads(images) {
  if (!enabled() || !images.length) return [];
  const apiKey = process.env.OPENAI_API_KEY;
  const results = await Promise.all(images.map(async (image) => {
    try {
      return { label: image.label, category: await screenOne(apiKey, image) };
    } catch (e) {
      console.warn(`[coin-builder] could not screen ${image.label}, letting it through: ${e.message}`);
      return { label: image.label, category: '' };
    }
  }));
  return results.filter((r) => r.category);
}

module.exports = { screenUploads, enabled };
