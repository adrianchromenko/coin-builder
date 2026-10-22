'use strict';

/**
 * Reads a coin design the way an estimator would, so the quote only includes what the design actually shows.
 *
 * A vision model is shown the finished front and back (the clean originals of the AI renders) together with the
 * customer's own words, and answers a fixed set of questions: which metal is it plated in, which faces carry
 * enamel color, does any face show two different platings, what kind of edge is it, is there a keychain loop, a
 * printed photo, numbering, names, lettering on the edge. The answers are then mapped onto the price chart's
 * finish groups, color sides and add-ons, each with a one-line reason the customer (and the team) can check.
 *
 * Two rules keep the quote honest:
 *  - An add-on is only included when the picture or the words clearly call for it. Anything that cannot be seen on
 *    a face render (lettering stamped on the rim edge, an epoxy dome) is taken from the written description alone,
 *    and only when it is asked for in so many words. Nothing is ever charged "just in case".
 *  - Every included item carries its reason, and the customer can switch any of them off on the quote form.
 *
 * Never throws: when the reading itself fails, { analyzed: false } is returned and the form falls back to guessing
 * the finish from the style notes, as before.
 */

const READ_MODEL = process.env.OPENAI_VERIFY_MODEL || 'gpt-5.4-mini';

const FINISHES = ['antique-brass', 'shiny-nickel', 'shiny-silver', 'satin-nickel', 'antique-copper', 'shiny-copper',
  'antique-silver', 'satin-silver', 'antique-gold', 'shiny-gold', 'satin-gold', 'black-nickel', 'matte-black', 'dye-black'];

const enabled = () => process.env.AI_READ_DESIGN !== '0' && !!process.env.OPENAI_API_KEY;

function prompt({ hasFront, hasBack, backMode, design }) {
  const pictures = hasFront
    ? (hasBack ? 'IMAGE 1 is the FRONT of the coin and IMAGE 2 is the BACK.' : `IMAGE 1 is the FRONT of the coin${backMode === 'blank' ? '; the back is plain metal with no artwork' : backMode === 'same' ? '; the back repeats the front' : ''}.`)
    : 'There is no picture; judge from the words alone.';
  return 'You are an estimator at a custom coin mint. A customer designed a challenge coin and you have to say what the finished coin '
    + `includes, so it is priced correctly from the mint's price chart. ${pictures} `
    + 'Also read what the customer wrote:\n'
    + `FRONT: ${design.front || '(nothing)'}\n`
    + `BACK: ${design.back || (backMode === 'blank' ? 'plain metal, no design' : backMode === 'same' ? 'same as the front' : '(nothing)')}\n`
    + `STYLE NOTES: ${design.style || '(none)'}\n\n`
    + 'Judge the PICTURES first; the words only settle what a picture cannot show. Be conservative: when something is not clearly there, answer false. '
    + 'Reply with JSON only:\n{'
    + `"finish": one of ${JSON.stringify(FINISHES)} (the base plating metal: "shiny" is bright and mirror-like, "antique" is darkened with a patina in the recesses, "satin" is brushed; pick "dye-black" only for an all-black coin), `
    + '"finish_why": "a few words on what you saw", '
    + '"front_color": true if the FRONT has enamel color fill (any painted color other than the metal itself) else false, '
    + '"back_color": the same for the BACK (false when there is no back artwork), '
    + '"two_tone_front": true ONLY if the FRONT clearly shows TWO DIFFERENT metal platings (for example gold areas and silver areas, or gold and black metal) on the same face; enamel colors do not count; else false, '
    + '"two_tone_back": the same for the BACK, '
    + '"edge": the treatment of the coin\'s OUTER EDGE, the narrow band of metal around the outside: "plain" (a smooth round rim; this is the usual answer), "reeded" (fine ridges around the outside like a quarter), "special" (the outline itself is wavy or scalloped, or the rim is diamond-cut or bevelled), or "unknown". A rope, bead, star or line border running on the FACE just inside the rim is part of the face artwork and means "plain", '
    + '"edge_text": true if the customer asked for lettering stamped on the narrow edge (the rim surface) of the coin, else false; this cannot be seen in a face picture, so take it from the words only, '
    + '"keychain": true if a keychain loop or ring is attached to the coin, else false, '
    + '"picture_insert": true if a photograph is printed on the coin (a photo print, not an engraved or enamel drawing), else false, '
    + '"sequential_numbers": true if the customer asked for each coin to carry its own serial number, else false, '
    + '"engraved_names": true if the customer asked for individual names engraved per coin, else false, '
    + '"elements": ["the main artwork and lettering on each face, briefly, so a person can check the reading"], '
    + '"summary": "two plain sentences, written to the customer: what their coin is (shape, metal, where the color is, the wording, anything special)"'
    + '}';
}

async function askVision({ apiKey, text, images }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: READ_MODEL,
      response_format: { type: 'json_object' },
      max_completion_tokens: 4000,
      messages: [{ role: 'user', content: [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } }))] }],
    }),
    signal: AbortSignal.timeout(90000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || `design read failed (${res.status})`);
  return JSON.parse(data.choices[0].message.content);
}

const yes = (v) => v === true || v === 'true';
const words = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * front, back: PNG buffers of the clean renders (either may be null). design: { front, back, style, backMode }.
 * chart: lib/pricing's chart (for the finish groups and add-on labels).
 * Returns { analyzed: true, model, finish, finishLabel, finishWhy, color, colorWhy, addons: [{ key, label, why }],
 *           elements, summary } or { analyzed: false }.
 */
async function analyzeDesign({ apiKey, front, back, design, chart }) {
  const backMode = ['custom', 'same', 'blank'].includes(design.backMode) ? design.backMode : 'custom';
  const images = [];
  if (front) images.push(`data:image/png;base64,${front.toString('base64')}`);
  if (front && back && backMode === 'custom') images.push(`data:image/png;base64,${back.toString('base64')}`);
  let out;
  try {
    out = await askVision({ apiKey, text: prompt({ hasFront: images.length > 0, hasBack: images.length > 1, backMode, design }), images });
  } catch (e) {
    console.warn('[coin-builder] design read skipped:', e.message);
    return { analyzed: false };
  }

  const finish = FINISHES.includes(out.finish) ? out.finish : '';
  const group = finish ? chart.finishGroups.find((g) => g.finishes.includes(finish)) : null;

  // Color sides: the chart prices color on no side, one side or both. A blank back has no color; a back that
  // repeats the front has the front's.
  const frontColor = yes(out.front_color);
  const backColor = backMode === 'blank' ? false : backMode === 'same' ? frontColor : yes(out.back_color);
  const sides = (frontColor ? 1 : 0) + (backColor ? 1 : 0);
  const color = sides === 2 ? 'two' : sides === 1 ? 'one' : 'none';
  const colorWhy = sides === 2 ? 'Enamel color on both faces' : sides === 1 ? `Enamel color on the ${frontColor ? 'front' : 'back'} only` : 'No enamel color: the metal and its recesses do the work';

  // Add-ons, each with the reason it is in
  const addons = [];
  const add = (key, why) => { const a = chart.addons.find((x) => x.key === key); if (a && !addons.some((x) => x.key === key)) addons.push({ key, label: a.label, why }); };
  const ttFront = yes(out.two_tone_front);
  const ttBack = backMode === 'blank' ? false : backMode === 'same' ? ttFront : yes(out.two_tone_back);
  if (ttFront && ttBack) add('two-tone-2-side', 'Two metal platings on both faces');
  else if (ttFront || ttBack) add('two-tone-1-side', `Two metal platings on the ${ttFront ? 'front' : 'back'}`);
  const edge = String(out.edge || '').toLowerCase();
  if (edge === 'reeded') add('reeded-edge', 'A reeded (ridged) edge around the rim');
  else if (edge === 'special') add('special-edge-1-side', 'A shaped decorative edge');
  if (yes(out.edge_text)) add('stamped-edge', 'Lettering stamped on the rim edge, as you asked');
  if (yes(out.keychain)) add('keychain', 'A keychain loop on the coin');
  if (yes(out.picture_insert)) add('picture-insert', 'A printed photograph on the coin');
  if (yes(out.sequential_numbers)) add('sequential', 'Each coin numbered, as you asked');
  if (yes(out.engraved_names)) add('engraved-names', 'Individual names engraved, as you asked');

  return {
    analyzed: true,
    model: READ_MODEL,
    pictures: images.length,
    finish: group ? group.key : '',
    finishLabel: group ? group.label : '',
    finishWhy: words(out.finish_why, 160),
    color,
    colorWhy,
    addons,
    elements: (Array.isArray(out.elements) ? out.elements : []).map((e) => words(e, 160)).filter(Boolean).slice(0, 8),
    summary: words(out.summary, 600),
  };
}

module.exports = { analyzeDesign, enabled };
