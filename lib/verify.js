'use strict';

/**
 * Proofreads a rendered coin. Image models still misspell lettering and drift on logos,
 * so every render is read back by a vision model and compared with what the customer
 * actually typed. The result drives the automatic retry and the badge the customer sees.
 *
 * Two lessons are baked in here, both found by testing against a deliberately misspelled coin:
 *  - A model that can see the art proof, or that reads "words", quietly autocorrects typos
 *    ("DEVELOPMNT" comes back as "DEVELOPMENT") and passes bad coins. So the lettering is read
 *    from the render ALONE, character by character, as if it were a serial code.
 *  - The logo comparison needs both images, so it runs as a separate pass that never feeds the lettering check.
 *
 * Never throws: if the check itself fails, the render is returned as "unchecked".
 */

const READ_MODEL = process.env.OPENAI_VERIFY_MODEL || 'gpt-5.4-mini';
const READS = 2; // independent readings; a line only passes when every reading agrees with the customer's wording

// Compare lettering the way a customer would: case, spacing and punctuation style do not matter, characters do
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const READ_PROMPT =
  'This is a photo of a metal token. The characters stamped on it are NOT necessarily English words: treat them as arbitrary serial codes that may be missing letters or contain odd letter sequences. '
  + 'Transcribe them by looking at each character shape individually, in reading order. Do not complete, correct or normalise anything into a dictionary word. '
  + 'Reply with JSON only: {"groups": [{"position": "top rim" | "bottom rim" | "center" | "other", '
  + '"characters": ["W", "E", "..."], "count": 0}]} with one entry per character, " " where there is a gap between groups of characters, and "?" for a character you cannot read. '
  + 'Use "top rim" and "bottom rim" only for characters that curve around the edge. If there are no characters at all, reply {"groups": []}.';

const COMPARE_PROMPT =
  'You are a quality inspector at a coin mint. IMAGE 1 is the flat art proof the customer approved. IMAGE 2 is a photo of the finished coin. '
  + 'Ignore the curved lettering around the rim and any plain straight line of lettering under the logo; someone else checks those. Judge only the artwork. '
  + 'Reply with JSON only: {"logo_match": 0-10 for how faithfully the logo in IMAGE 2 keeps the shapes, proportions, arrangement and inner lettering of the logo in IMAGE 1 '
  + '(10 = clearly the very same logo, 5 = recognisable but redrawn or altered, 0 = a different logo; use 10 if IMAGE 1 has no logo), '
  + '"logo_issues": "what changed in the logo, in a few words, or empty string", '
  + '"logo_lettering": ["every word or character group that is part of the logo artwork itself in IMAGE 1, such as a brand name or wordmark; empty list if the logo has no lettering"], '
  + '"added_elements": ["anything on the coin face in IMAGE 2 that is not in IMAGE 1 at all, such as extra words, dates, stars, banners, wreaths or figures. Everything that is part of the logo in IMAGE 1 (including its own lettering and any trademark symbol) and the small separator dots on the rim are NOT additions; empty list if nothing was added"], '
  + '"rim_border": "the decorative border running just inside the raised outer rim of the coin in IMAGE 2: one of rope (a twisted cord), beads (a ring of round dots), stars, or line (a plain thin line or nothing decorative)"}';

async function askVision({ apiKey, prompt, images }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: READ_MODEL,
      response_format: { type: 'json_object' },
      max_completion_tokens: 6000,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } }))] }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || `vision check failed (${res.status})`);
  return JSON.parse(data.choices[0].message.content);
}

// One reading of the render -> [{ position, text }]
async function readLettering(apiKey, render) {
  const out = await askVision({ apiKey, prompt: READ_PROMPT, images: [render] });
  return (Array.isArray(out.groups) ? out.groups : []).map((g) => ({
    position: String(g.position || 'other'),
    text: (Array.isArray(g.characters) ? g.characters.join('') : String(g.characters || '')).replace(/\s+/g, ' ').trim(),
  })).filter((g) => norm(g.text) || g.text.includes('?'));
}

/**
 * texts: { top, bottom, center } as the customer typed them (compared without regard to case).
 * border: the rim style ordered ('plain', 'rope', 'beads', 'stars'); a decorative border that did not appear fails the render.
 * Returns { checked, ok, textOk, logoOk, borderOk, score, lines: [{ where, expected, read, ok }], extraText, logoMatch, logoIssues, feedback }.
 */
async function verifyRender({ apiKey, guide, render, texts, hasLogo, border = 'plain' }) {
  let readings, compared;
  try {
    [readings, compared] = await Promise.all([
      Promise.all(Array.from({ length: READS }, () => readLettering(apiKey, render))),
      askVision({ apiKey, prompt: COMPARE_PROMPT, images: [guide, render] }),
    ]);
  } catch (e) {
    console.warn('[coin-builder] render check skipped:', e.message);
    return { checked: false, ok: false, score: 0, lines: [], extraText: [], logoMatch: null, logoIssues: '', borderOk: null, feedback: '' };
  }

  const wanted = [['top', 'top rim', 'along the top of the rim', texts.top], ['bottom', 'bottom rim', 'along the bottom of the rim', texts.bottom], ['center', 'center', 'in the center', texts.center]]
    .filter(([, , , expected]) => expected);

  // Lettering that belongs to the logo itself (a wordmark like "Jeep", a tagline inside a crest). The reader cannot
  // tell it from the customer's center wording, so it is identified from the art proof and set aside.
  const logoWords = new Set((hasLogo && Array.isArray(compared.logo_lettering) ? compared.logo_lettering : [])
    .flatMap((t) => String(t).split(/\s+/)).map(norm).filter(Boolean));

  // What one reading saw for a line, and whether it is right. The customer's wording must appear as an exact run of
  // whole words (wrapped wording comes back as several groups, so groups are joined first). Around the rim nothing
  // else may be there; in the center the only other words allowed are the logo's own.
  const judge = (groups, position, expected) => {
    const want = expected.split(' ').map(norm).filter(Boolean);
    const inPlace = groups.filter((g) => g.position === position || (position === 'center' && g.position === 'other'));
    const read = inPlace.map((g) => g.text).join(' ');
    // Compare as one string when the reader dropped or added spaces, word by word otherwise
    if (norm(read) === want.join('')) return { read, ok: true };
    const got = read.split(' ').map(norm).filter(Boolean);
    for (let i = 0; i + want.length <= got.length; i++) {
      if (!want.every((w, k) => got[i + k] === w)) continue;
      const rest = [...got.slice(0, i), ...got.slice(i + want.length)];
      // leftovers may only be the logo's own words, or its trademark mark read as a letter: (R), TM, (C)
      if (position === 'center' && hasLogo && rest.every((w) => logoWords.has(w) || /^(R|TM|C|SM)$/.test(w))) return { read: expected, ok: true };
    }
    return { read, ok: false };
  };
  const lines = wanted.map(([where, position, place, expected]) => {
    const verdicts = readings.map((groups) => judge(groups, position, expected));
    const wrong = verdicts.find((v) => !v.ok);
    return { where, place, expected, read: (wrong || verdicts[0]).read, ok: !wrong };
  });

  // Lettering nobody asked for. Rim lettering is never part of a logo; with a logo on the coin, stray center
  // lettering is usually the logo's own wording, so there the side-by-side comparison decides instead.
  const expectedAll = new Set(wanted.map(([, , , expected]) => norm(expected)));
  const strayPositions = hasLogo ? ['top rim', 'bottom rim'] : ['top rim', 'bottom rim', 'center', 'other'];
  const stray = new Set();
  for (const groups of readings) for (const g of groups) if (strayPositions.includes(g.position) && !expectedAll.has(norm(g.text)) && !wanted.some(([, position]) => position === g.position)) stray.add(g.text);
  // Trademark marks belong to the customer's logo; they are never something the render "added"
  const added = (Array.isArray(compared.added_elements) ? compared.added_elements : []).map((t) => String(t).trim())
    .filter((t) => t && !/[®™©]|trade ?mark|registered|copyright/i.test(t))
    // nor is the customer's own wording, or the logo's, however the inspector phrases it
    .filter((t) => { const n = norm(t); return n && ![...expectedAll].some((e) => e.includes(n) || n.includes(e)) && !t.split(/\s+/).map(norm).filter(Boolean).every((w) => logoWords.has(w)); })
    .slice(0, 5);
  const extraText = [...stray, ...added];

  const logoMatch = hasLogo && Number.isFinite(Number(compared.logo_match)) ? Math.max(0, Math.min(10, Number(compared.logo_match))) : null;
  const logoIssues = hasLogo ? String(compared.logo_issues || '').trim().slice(0, 300) : '';
  const logoOk = logoMatch === null || logoMatch >= 7;
  const textOk = lines.every((l) => l.ok) && extraText.length === 0;
  // The rim border only fails when a decorative one was ordered and the inspector clearly saw something else
  const BORDER_WORDS = { rope: 'a twisted rope border', beads: 'a ring of raised beads', stars: 'a ring of raised stars' };
  const seenBorder = String(compared.rim_border || '').toLowerCase();
  const borderOk = !BORDER_WORDS[border] || !seenBorder || seenBorder.includes(border);

  const problems = [];
  for (const l of lines) if (!l.ok) problems.push(`The lettering ${l.place} came out as "${l.read || '(missing)'}" but it must read exactly "${l.expected}".`);
  if (extraText.length) problems.push(`It added things that must not be there: ${extraText.map((t) => `"${t}"`).join(', ')}. Remove them.`);
  if (!logoOk) problems.push(`The logo was changed${logoIssues ? ` (${logoIssues})` : ''}. Reproduce the logo from IMAGE 1 exactly.`);
  if (!borderOk) problems.push(`The border just inside the rim is wrong: it came out as "${seenBorder}" but the coin must have ${BORDER_WORDS[border]} running all the way around, as drawn in IMAGE 1.`);

  return {
    checked: true,
    ok: textOk && logoOk && borderOk,
    textOk,
    logoOk,
    borderOk,
    // Used to pick the better of two attempts: correct lines dominate, then nothing added, then the logo, then the rim border
    score: lines.filter((l) => l.ok).length * 20 - extraText.length * 8 + (logoMatch === null ? 10 : logoMatch) + (borderOk ? 5 : 0),
    lines: lines.map(({ where, expected, read, ok }) => ({ where, expected, read, ok })),
    extraText,
    logoMatch,
    logoIssues,
    feedback: problems.join(' '),
  };
}

// ---------- the described coin ----------
const LOGO_PROMPT =
  'You are a quality inspector at a coin mint. IMAGE 1 is the customer\'s logo artwork. IMAGE 2 is a photo of the finished coin. '
  + 'Reply with JSON only: {"logo_match": 0-10 for how faithfully the logo on the coin in IMAGE 2 keeps the shapes, proportions, arrangement, colors and inner lettering of IMAGE 1 '
  + '(10 = clearly the very same logo, 5 = recognisable but redrawn or altered, 0 = missing or a different logo), '
  + '"logo_issues": "what changed in the logo, in a few words, or empty string"}';

const SHAPE_PROMPT =
  'You are a quality inspector at a coin mint. IMAGE 1 is a photo of the FRONT of a custom die-cut coin. IMAGE 2 is a photo of the BACK of what should be the very same coin, turned over. '
  + 'Look only at the OUTER OUTLINE of the metal in each photo (the silhouette against the background), not at the artwork or lettering on the face. '
  + 'Reply with JSON only: {"shape_match": 0-10 for how exactly the outline in IMAGE 2 is the same die-cut shape as IMAGE 1 '
  + '(10 = the same silhouette, same proportions and the same number of points, lobes and notches; a left-right mirror image counts as the same because the coin is turned over; '
  + '5 = roughly similar but simplified or with parts changed; 0 = a different shape, or a plain circle), '
  + '"shape_issues": "how the outline differs, in a few words, or empty string"}';

/**
 * Proofreads a render made from a description. `phrases` is the exact wording the customer put in quotes; each must be
 * read back, letter for letter, in every reading. `logo` (data URL) is the customer's artwork, compared when given.
 * Never throws: if the check itself fails, the render is returned as "unchecked".
 */
async function verifyDescribed({ apiKey, logo, render, phrases, hasLogo, front = null }) {
  let readings, compared, outline;
  try {
    [readings, compared, outline] = await Promise.all([
      Promise.all(Array.from({ length: READS }, () => readLettering(apiKey, render))),
      hasLogo && logo ? askVision({ apiKey, prompt: LOGO_PROMPT, images: [logo, render] }) : Promise.resolve({}),
      // `front` is given only for the back of an odd-shaped coin: its outline has to be the front's
      front ? askVision({ apiKey, prompt: SHAPE_PROMPT, images: [front, render] }) : Promise.resolve({}),
    ]);
  } catch (e) {
    console.warn('[coin-builder] render check skipped:', e.message);
    return { checked: false, ok: false, score: 0, lines: [], extraText: [], logoMatch: null, logoIssues: '', borderOk: null, feedback: '' };
  }
  const seen = readings.map((groups) => groups.map((g) => norm(g.text)).join(''));
  const readAll = readings[0].map((g) => g.text).filter(Boolean).join(' / ');
  const lines = (phrases || []).map((expected) => {
    const ok = seen.every((s) => s.includes(norm(expected)));
    return { where: 'on the coin', place: 'on the coin', expected, read: ok ? expected : readAll, ok };
  });
  const logoMatch = hasLogo && logo && Number.isFinite(Number(compared.logo_match)) ? Math.max(0, Math.min(10, Number(compared.logo_match))) : null;
  const logoIssues = logoMatch === null ? '' : String(compared.logo_issues || '').trim().slice(0, 300);
  const logoOk = logoMatch === null || logoMatch >= 7;
  const shapeMatch = front && Number.isFinite(Number(outline.shape_match)) ? Math.max(0, Math.min(10, Number(outline.shape_match))) : null;
  const shapeIssues = shapeMatch === null ? '' : String(outline.shape_issues || '').trim().slice(0, 300);
  const shapeOk = shapeMatch === null || shapeMatch >= 7;
  const textOk = lines.every((l) => l.ok);
  const problems = [];
  for (const l of lines) if (!l.ok) problems.push(`The wording "${l.expected}" is missing or misspelled: the coin reads "${l.read || '(nothing)'}". It must read exactly "${l.expected}".`);
  if (!logoOk) problems.push(`The logo was changed${logoIssues ? ` (${logoIssues})` : ''}. Reproduce the logo from IMAGE 1 exactly.`);
  if (!shapeOk) problems.push(`The outline of the coin does not match the front in IMAGE 1${shapeIssues ? ` (${shapeIssues})` : ''}. The back is the same die-cut piece of metal: trace the outline of IMAGE 1 exactly, with the same number of points and lobes, and do not fall back to a circle.`);
  return {
    checked: true,
    ok: textOk && logoOk && shapeOk,
    textOk,
    logoOk,
    shapeOk,
    borderOk: null,
    score: lines.filter((l) => l.ok).length * 20 + (logoMatch === null ? 10 : logoMatch) + (shapeMatch === null ? 10 : shapeMatch),
    lines: lines.map(({ where, expected, read, ok }) => ({ where, expected, read, ok })),
    extraText: [],
    logoMatch,
    logoIssues,
    shapeMatch,
    shapeIssues,
    feedback: problems.join(' '),
  };
}

module.exports = { verifyRender, verifyDescribed };
