'use strict';

// Options mirror the quote form at coinsforanything.com/quote (Gravity Forms form 2).
// `label` is the exact choice text on that form, so saved orders line up with it;
// the other text is what the image model is told.

const FINISHES = {
  'antique-brass': { label: 'Antique Brass', plating: 'antique brass plating: warm yellow-brown brass with dark oxidized recesses and softly burnished raised areas' },
  'antique-copper': { label: 'Antique Copper', plating: 'antique copper plating: deep reddish-brown copper with dark oxidized recesses and softly burnished raised areas' },
  'shiny-copper': { label: 'Shiny Copper', plating: 'shiny copper plating: bright, mirror-polished reddish-orange copper with crisp reflections' },
  'antique-gold': { label: 'Antique Gold', plating: 'antique gold plating: muted gold with dark oxidized recesses and softly burnished raised areas' },
  'shiny-gold': { label: 'Shiny Gold', plating: 'shiny gold plating: bright, mirror-polished yellow gold with crisp reflections' },
  'satin-gold': { label: 'Satin Gold', plating: 'satin gold plating: soft, matte, finely brushed yellow gold with diffuse low-glare reflections and no mirror shine' },
  'antique-silver': { label: 'Antique Silver', plating: 'antique silver plating: muted silver with dark oxidized recesses and softly burnished raised areas' },
  'shiny-silver': { label: 'Shiny Silver', plating: 'shiny silver plating: bright, mirror-polished cool white silver with crisp reflections' },
  'satin-silver': { label: 'Satin Silver', plating: 'satin silver plating: soft, matte, finely brushed silver with diffuse low-glare reflections and no mirror shine' },
  'shiny-nickel': { label: 'Shiny Nickel', plating: 'shiny nickel plating: bright, mirror-polished nickel, slightly warmer and greyer than silver' },
  'satin-nickel': { label: 'Satin Nickel', plating: 'satin nickel plating: soft, matte, finely brushed grey nickel with diffuse low-glare reflections and no mirror shine' },
  'black-nickel': { label: 'Black Nickel', plating: 'black nickel plating: glossy dark gunmetal, almost black, with sharp bright highlights' },
};
const DEFAULT_FINISH = 'shiny-gold';
// Finish keys used before the list matched the quote form
const LEGACY_FINISHES = { gold: 'shiny-gold', silver: 'shiny-silver', copper: 'shiny-copper' };

const COLORS = {
  'color-one': { label: 'Unlimited Color, One Side' },
  'color-both': { label: 'Unlimited Color, Both Sides' },
  none: { label: 'No Color' },
};
const DEFAULT_COLOR = 'color-one';

// `label` matches the quote form (everything but round is "Odd Shaped" there); `prompt` tells the image model the outline
const SHAPES = {
  round: { label: 'Round', prompt: null },
  shield: { label: 'Odd Shaped (shield)', prompt: 'a shield-shaped coin: a flat top edge and straight sides that curve down to a point at the bottom' },
  star: { label: 'Odd Shaped (star)', prompt: 'a five-pointed star-shaped coin' },
  hexagon: { label: 'Odd Shaped (hexagon)', prompt: 'a hexagon-shaped coin: six straight sides with a point at the top and at the bottom' },
  octagon: { label: 'Odd Shaped (octagon)', prompt: 'an octagon-shaped coin: eight straight sides, flat at the top and bottom' },
  square: { label: 'Odd Shaped (square)', prompt: 'a square coin with softly rounded corners' },
  heart: { label: 'Odd Shaped (heart)', prompt: 'a heart-shaped coin' },
  arrowhead: { label: 'Odd Shaped (arrowhead)', prompt: 'an arrowhead-shaped coin, pointing straight up' },
  dogtag: { label: 'Odd Shaped (dog tag)', prompt: 'a military dog-tag shaped coin: a tall rectangle with fully rounded corners' },
  artwork: { label: 'Odd Shaped (cut to artwork)', prompt: 'a custom die-cut coin whose outer edge follows the silhouette of the design itself, with a metal rim around the artwork' },
};
const DEFAULT_SHAPE = 'round';
const LEGACY_SHAPES = { odd: 'artwork' };

// The described coin only asks round or not. `label` is the quote form's choice text; the actual outline of an
// odd-shaped coin comes from the customer's own words (or, failing that, is cut to the artwork).
const COIN_SHAPES = {
  round: { label: 'Round' },
  odd: { label: 'Odd Shaped' },
};
const normalizeCoinShape = (key) => (COIN_SHAPES[key] ? key : 'round');
const coinShapeLabel = (key) => COIN_SHAPES[normalizeCoinShape(key)].label;

// `prompt` is null for options that cannot be seen on the front face of the coin
const ADDONS = {
  'epoxy-one': { label: 'Epoxy Dome, One Side (adds .35¢)', excludes: 'epoxy-both' },
  'epoxy-both': { label: 'Epoxy Dome, Both Sides (adds .40¢)', excludes: 'epoxy-one' },
  numbering: { label: 'Numbering (adds .35¢)' },
  'bottle-opener': { label: 'Bottle Opener' },
  'key-chain': { label: 'Key Chain (.75¢ each + $75 set-up)' },
  'two-tone-one': { label: '2-Tone Plating, One Side (adds 65¢)', excludes: 'two-tone-both' },
  'two-tone-both': { label: '2-Tone Plating, Both Sides (adds $1.30)', excludes: 'two-tone-one' },
  'edge-text': { label: 'Rolling Edge Text' },
  'reeded-edge': { label: 'Reeded Edge' },
};

function normalizeFinish(key) {
  const k = LEGACY_FINISHES[key] || key;
  return FINISHES[k] ? k : DEFAULT_FINISH;
}
const normalizeColor = (key) => (COLORS[key] ? key : DEFAULT_COLOR);
const normalizeShape = (key) => { const k = LEGACY_SHAPES[key] || key; return SHAPES[k] ? k : DEFAULT_SHAPE; };

// Accepts an array or a comma-separated string; drops unknown keys and the
// second of any one-side / both-sides pair.
function normalizeAddons(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const out = [];
  for (const raw of list) {
    const k = String(raw).trim();
    if (!ADDONS[k] || out.includes(k) || out.includes(ADDONS[k].excludes)) continue;
    out.push(k);
  }
  return out;
}

function finishLabel(key) {
  return FINISHES[normalizeFinish(key)].label;
}

// The second metal for 2-tone plating: whatever contrasts with the main finish
function contrastMetal(finish) {
  return /gold|brass|copper/.test(finish) ? 'polished silver' : 'polished gold';
}

// Decorative border just inside the raised rim. Described in full because image models drop it: a rope border
// was regularly rendered as a plain ring until the wording below spelled out what it looks like.
const RIMS = {
  plain: 'a plain thin engraved line just inside the raised rim',
  rope: 'a raised twisted-rope border just inside the raised rim: one continuous cord of thick diagonal twisted strands, clearly three-dimensional, running all the way around the coin without a break',
  beads: 'a ring of small, evenly spaced, raised round beads just inside the raised rim, like a string of pearls running all the way around the coin',
  stars: 'a ring of small, evenly spaced, raised five-pointed stars just inside the raised rim, running all the way around the coin',
};
const normalizeBorder = (key) => (RIMS[key] ? key : 'plain');

// Center background. Color is any hex value (the browser offers an enamel palette plus a custom picker);
// the name only helps the image model, so it is reduced to plain letters before it goes anywhere near a prompt.
const TEXTURES = {
  smooth: '',
  sandblast: 'a fine, even, matte sandblasted grain',
  sunburst: 'fine straight rays radiating from the exact center out to the inner ring, like a sunburst, struck into the metal as shallow alternating facets that catch the light',
  diamond: 'a fine diamond-cut cross-hatch of shallow crossing diagonal grooves that sparkles as it catches the light',
};
function normalizeBackground(b) {
  b = b && typeof b === 'object' ? b : {};
  const color = /^#[0-9a-f]{6}$/i.test(String(b.color || '')) ? String(b.color).toUpperCase() : '';
  const name = color ? String(b.colorName || '').replace(/[^a-z ]/gi, '').trim().slice(0, 24).toLowerCase() : '';
  const texture = Object.prototype.hasOwnProperty.call(TEXTURES, b.texture) ? b.texture : 'smooth';
  return { color, name: name && name !== 'custom color' ? name : '', texture };
}

// The coin lettering, cleaned the same way the layout preview shows it. Capitalization is kept exactly as typed:
// customers write things like "CoinsForAnything.com" and expect it stamped that way.
function normalizeTexts(t) {
  const clean = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
  t = t && typeof t === 'object' ? t : {};
  return { top: clean(t.top, 40), bottom: clean(t.bottom, 40), center: clean(t.center, 30) };
}

// "WEB DEV" -> 2 words, 6 letters: W-E-B / D-E-V. Counting and spelling the words is what
// keeps image models from dropping, doubling, or swapping letters in long words.
function spellOut(text) {
  const words = text.split(' ');
  const letters = text.replace(/ /g, '').length;
  return `${words.length} word${words.length === 1 ? '' : 's'}, ${letters} character${letters === 1 ? '' : 's'}: ${words.map((w) => w.split('').join('-')).join(' / ')}`;
}

/**
 * The render prompt. It is assembled here, on the server, from the customer's actual
 * choices; nothing in it is free text from the browser except the quoted coin lettering.
 *
 *   texts      { top, bottom, center } lettering on the coin
 *   hasLogo    whether the layout has a logo in the middle
 *   border     rim style key
 *   feedback   what a previous attempt got wrong (from lib/verify.js), for the retry
 */
function buildPrompt({ finish, color, shape, addons, texts, hasLogo = true, border, background, centerFirstLineWords = 0, referenceCount = 0, feedback = '' }) {
  const bg = normalizeBackground(background);
  if (normalizeColor(color) === 'none') bg.color = ''; // a bare-metal coin has no enamel anywhere
  finish = normalizeFinish(finish);
  color = normalizeColor(color);
  shape = normalizeShape(shape);
  addons = normalizeAddons(addons);
  border = normalizeBorder(border);
  texts = normalizeTexts(texts);
  const has = (k) => addons.includes(k);
  const odd = shape !== 'round';
  const colored = color !== 'none';

  // Long center wording is wrapped onto two lines by the layout; describe the same break the art proof shows
  const words = texts.center.split(' ');
  const wrapAt = Number.isInteger(centerFirstLineWords) && centerFirstLineWords > 0 && centerFirstLineWords < words.length ? centerFirstLineWords : 0;
  const centerPlace = 'in straight horizontal lettering' + (hasLogo ? ' below the logo' : ' across the center')
    + (wrapAt ? `, on two centered lines: "${words.slice(0, wrapAt).join(' ')}" above "${words.slice(wrapAt).join(' ')}"` : ', on one line');
  const lines = [
    ['curved along the TOP of the rim, reading left to right, letter tops pointing outward', texts.top],
    ['curved along the BOTTOM of the rim, reading left to right, letter tops pointing toward the center', texts.bottom],
    [centerPlace, texts.center],
  ].filter(([, t]) => t);

  const sections = [];

  sections.push(
    'You are producing the customer proof photo for a custom minted challenge coin. The customer is paying for THEIR words and THEIR logo, '
    + 'so getting those exactly right matters more than anything else in the image.\n'
    + "IMAGE 1 is the customer's approved flat art proof of the coin face. It is the single source of truth for what is on the coin and where. "
    + 'Your job is only to turn that flat proof into a photograph of the finished metal coin.'
    + (referenceCount > 0
      ? `\nImages 2 to ${referenceCount + 1} are photos of unrelated coins from our factory. Use them ONLY to match the look of real minted metal: `
        + 'relief depth, rim and edge, enamel, lighting and photography. Never copy any wording, logo, emblem, shape or layout from them. '
        + "Where they differ from this order's finish, color or shape, this order wins."
      : '')
  );

  sections.push(
    'TEXT (must be letter-perfect)\n'
    + (lines.length
      ? `The coin has exactly ${lines.length} line${lines.length === 1 ? '' : 's'} of lettering. Capital and small letters are used EXACTLY as written here; never change the case of a letter:\n`
        + lines.map(([where, t]) => `- "${t}" ${where}. ${spellOut(t)}.`).join('\n') + '\n'
        + 'Trace the lettering from IMAGE 1: the same words, spelling, order, spacing, position and curvature. '
        + 'Render it as raised metal letters with flat polished tops in a bold, plain, evenly spaced serif typeface, big enough to read at a glance. '
        + 'IMAGE 1 draws the lettering in solid ink only so that it is easy to read. On the coin the letters are struck from the same metal and plating as the rim: never black, never white, never painted or enamel-filled. '
        + 'Every letter must be complete, correctly formed and unmistakable; check each word against the spelling above, letter by letter. '
        + 'Do not abbreviate, reword, translate, repeat, mirror, or decorate the lettering, and never let it run off the coin or overlap the logo.\n'
        + 'There is NO other lettering anywhere on the coin: no dates, mottos, initials, mint marks, numbers, or tiny filler text.'
      : 'This coin has NO lettering at all. Do not add any words, letters, numbers, dates, or mottos anywhere.')
      + (hasLogo ? ' (Lettering that is part of the logo artwork itself stays inside the logo, exactly as drawn.)' : '')
  );

  if (hasLogo) {
    sections.push(
      'LOGO (must stay the same logo)\n'
      + "The artwork in the middle of IMAGE 1 is the customer's own trademarked logo. Keep its exact shapes, proportions, arrangement and any lettering inside it, at the same size and position as in IMAGE 1. "
      + 'Do not redraw it in another style, simplify it, embellish it, straighten or reinterpret it, or swap any element for something similar. '
      + 'The only change allowed is turning it into coin relief: '
      + (colored
        ? 'its colored areas become opaque hard enamel in the SAME colors as the artwork, each color in its own recessed cell separated by thin raised metal lines.'
        : 'ignore its colors and sculpt it purely as raised and recessed relief in the bare metal.')
    );
  }

  if (bg.color || bg.texture !== 'smooth') {
    // Image models drift toward bright, saturated colors, so say in words how dark or light the shade is
    const n = parseInt(bg.color.slice(1) || '0', 16);
    const lightness = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    const depth = !bg.color ? '' : lightness < 0.22 ? 'very dark, deep ' : lightness < 0.4 ? 'dark, rich ' : lightness > 0.8 ? 'very light ' : '';
    const shade = `${depth}${bg.name ? bg.name + ' ' : ''}(${bg.color}, exactly the background color shown in IMAGE 1, no brighter and no more saturated)`;
    const inside = [hasLogo ? 'the logo' : '', texts.center ? 'the center lettering' : ''].filter(Boolean).join(' and ') || 'the design';
    sections.push(
      'CENTER BACKGROUND\n'
      + 'The round field in the middle of the coin, inside the inner ring and behind ' + inside + ', has a background. It is recessed slightly below the ring around it. '
      + (bg.color && bg.texture !== 'smooth'
        ? `First the metal floor of that field is struck with ${TEXTURES[bg.texture]}. Then the field is filled level with TRANSLUCENT ${shade} enamel, glossy like colored glass, so the texture is clearly visible through the color and glints as light crosses it. `
        : bg.color
          ? `It is filled level with opaque, glossy ${shade} hard enamel: one flat, even color with a smooth glass-like surface and soft reflections, no gradient and no pattern. `
          : `The bare metal floor of that field is struck with ${TEXTURES[bg.texture]}, in the same plating as the rest of the coin and a little darker and more matte than the polished raised parts. No paint. `)
      + (bg.color ? `${hasLogo ? 'The logo keeps its own colors exactly as described above, edged by thin raised metal lines that separate it cleanly from the background color. ' : ''}${texts.center ? 'The center lettering rises out of the enamel as raised polished metal with clean vertical walls, clearly standing above the colored surface. ' : ''}Everything on the background must stay crisp and fully readable against it. ` : `${inside.charAt(0).toUpperCase() + inside.slice(1)} stand above the texture as smooth raised metal and must stay crisp and fully readable against it. `)
      + 'The background stops exactly at the inner ring: the band that carries the rim lettering, the rim and the edge stay plain metal with no color and no texture.'
    );
  }

  const edge = has('reeded-edge')
    ? 'The edge (the thin outer surface of the coin, seen at the very outline) is reeded: fine, even vertical grooves all the way around, like a US quarter.'
    : 'The edge (the thin outer surface of the coin, seen at the very outline) is smooth and plain, polished metal only: NO reeding, NO grooves, NO ridges, NO notches.';
  sections.push(
    'RIM AND EDGE\n'
    + `Around the face runs a raised outer rim. Just inside it is ${RIMS[border]}. IMAGE 1 draws this border; reproduce it clearly and completely${border === 'plain' ? '' : ', as raised metal relief in the same plating as the rim'}. `
    + edge
  );

  sections.push(
    'NOTHING ELSE ON THE COIN\n'
    + `Apart from ${[lines.length ? 'the lettering' : '', texts.top && texts.bottom ? 'one small raised dot on the left and one on the right of the rim, separating the top lettering from the bottom lettering' : '', hasLogo ? 'the logo' : '', bg.color || bg.texture !== 'smooth' ? 'the center background described above' : '', RIMS[border]].filter(Boolean).join(', ')}, the face is clean open metal. `
    + 'Do not add stars, flags, eagles, laurels, banners, scrollwork, scenery, patterns, or any ornament that is not in IMAGE 1.'
  );

  const build = [];
  build.push(`Plating: ${FINISHES[finish].plating}.`);
  build.push(colored
    ? (bg.color ? 'Color: enamel only inside the logo and in the center background, as described; the lettering, the ring of rim lettering, the rim and the edge stay bare metal with no paint.'
      : 'Color: enamel only inside the logo as described; the lettering, rim and open background stay bare metal with no paint.')
    : 'Color: none. Bare metal only, with no enamel, paint or ink anywhere.');
  build.push(odd
    ? `Shape: ${SHAPES[shape].prompt}, NOT a circle. IMAGE 1 draws the exact outline: the metal ends where the dark background begins. Cut the coin to that outline precisely, `
      + `with a raised rim following the outline all the way around and ${has('reeded-edge') ? 'a reeded edge' : 'a smooth plain edge'}. Keep every element inside the outline, placed as in IMAGE 1.`
    : `Shape: a perfectly round coin with a raised outer rim and ${has('reeded-edge') ? 'a reeded edge' : 'a smooth plain edge'}.`);
  if (has('two-tone-one') || has('two-tone-both')) build.push(`2-tone plating: the raised details, lettering, rim and border are in the main plating, and the recessed field inside the border is plated in contrasting ${contrastMetal(finish)}, exactly as the two different metal tones are shown in IMAGE 1.`);
  if (has('epoxy-one') || has('epoxy-both')) build.push('Epoxy dome: the whole face is sealed under a clear, glossy, slightly convex epoxy dome with soft curved highlights. The lettering must stay fully readable through it.');
  if (has('bottle-opener')) build.push('Bottle opener: a clean cut-out opening through the metal with a sturdy lip for catching a bottle cap, placed where it does not touch the logo or any lettering.');
  if (has('key-chain')) build.push('Key chain: a small metal loop at the top edge holds a split key ring on a short chain, in the same plating.');
  sections.push('THE COIN\n' + build.join('\n'));

  sections.push(
    'THE PHOTO\n'
    + 'A sharp, professional product photograph: real die-struck metal with crisp relief, believable depth, fine surface texture and natural reflections. '
    + 'The coin is seen straight on (not tilted), centered, filling most of the frame, fully inside the frame, under soft even studio lighting on a plain dark charcoal background. '
    + `One coin only. No hands, no stand, ${has('key-chain') ? 'no objects other than the key ring' : 'no other objects'}, no watermark, no caption.`
  );

  if (feedback) {
    sections.push('CORRECTION\nA previous attempt at this exact coin was rejected. ' + String(feedback).slice(0, 600) + ' Fix that this time; everything above still applies.');
  }

  return sections.join('\n\n');
}

// ---------- the described coin ----------
// The simple flow: the customer describes each face in their own words. The prompt
// is assembled from that. Exact wording is whatever they put in double quotes, which is also what gets proofread.

// Free text from the customer, made safe for a prompt: one line, no control characters, capped
const freeText = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// The exact wording: everything the customer put in double quotes, in order, without repeats
function quotedPhrases(text) {
  const out = [];
  const re = /["\u201c\u201d]([^"\u201c\u201d]{1,60})["\u201c\u201d]/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const t = m[1].replace(/\s+/g, ' ').trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 8);
}

// The metal the customer seems to want, for picking matching factory photos (the prompt itself quotes their words)
function guessFinish(style) {
  const t = String(style || '').toLowerCase();
  const tone = /antique|aged|vintage|oxidi/.test(t) ? 'antique' : /satin|brushed|matte/.test(t) ? 'satin' : 'shiny';
  if (/black nickel|gunmetal|black metal/.test(t)) return 'black-nickel';
  if (/copper/.test(t)) return tone === 'antique' ? 'antique-copper' : 'shiny-copper';
  if (/brass/.test(t)) return 'antique-brass';
  if (/nickel/.test(t)) return tone === 'satin' ? 'satin-nickel' : 'shiny-nickel';
  if (/silver|chrome|steel/.test(t)) return tone === 'antique' ? 'antique-silver' : tone === 'satin' ? 'satin-silver' : 'shiny-silver';
  return tone === 'antique' ? 'antique-gold' : tone === 'satin' ? 'satin-gold' : 'shiny-gold';
}

/**
 * The render prompt for one face of a described coin.
 *   style        the customer's style / finish / theme notes (free text)
 *   description  the customer's description of this face (free text; quoted parts are exact wording)
 *   note         what the customer wants different from the version they already saw (free text, may be empty)
 *   sideName     'front' | 'back'
 *   hasLogo      IMAGE 1 is the customer's artwork
 */
function buildDescribedPrompt({ style, description, note = '', shape = 'round', sideName = 'front', hasLogo = false, hasFront = false, referenceCount = 0, feedback = '' }) {
  note = freeText(note, 300);
  const odd = normalizeCoinShape(shape) === 'odd';
  style = freeText(style, 300);
  description = freeText(description, 600);
  const phrases = quotedPhrases(description);
  const face = sideName === 'back' ? 'BACK' : 'FRONT';
  // Input images, in order: the finished front (back renders only), the customer's logo, then factory photos
  const logoIdx = hasFront ? 2 : 1;
  const firstRef = 1 + (hasFront ? 1 : 0) + (hasLogo ? 1 : 0);
  const sections = [];

  sections.push(
    `You are producing the customer proof photo of the ${face} face of a custom minted challenge coin. The customer is paying for THEIR words and THEIR artwork, `
    + 'so getting those exactly right matters more than anything else in the image.'
    + (hasFront
      ? '\nIMAGE 1 is the FRONT face of this very same coin, already approved by the customer. You are drawing the BACK of that same physical coin, turned over. '
        + 'Keep everything that belongs to the coin itself identical to IMAGE 1: the exact outline and shape, the raised rim, the border just inside it, the edge, the metal finish and plating color, '
        + 'the enamel palette, the relief depth, and the same size, angle, lighting and background in the photo. Only the artwork on the face is different: it is described below. '
        + "Do not copy the front's artwork or lettering onto the back unless the description asks for it."
      : '')
    + (hasLogo
      ? `\nIMAGE ${logoIdx} is the customer's own logo or artwork. Reproduce it exactly: the same shapes, proportions, arrangement, colors and any lettering inside it. `
        + 'Do not redraw it in another style, simplify it, embellish it or swap any element. Place it where the customer says below; if they do not say, center it. '
        + 'On the coin its colored areas become hard enamel in the same colors, each color in its own recessed cell separated by thin raised metal lines.'
      : '')
    + (referenceCount > 0
      ? `\nImages ${firstRef} to ${firstRef + referenceCount - 1} are photos of unrelated coins from our factory. Use them ONLY to match the look of real minted metal: `
        + 'relief depth, rim and edge, enamel, lighting and photography. Never copy any wording, logo, emblem, shape or layout from them.'
        + (odd ? ' They are odd-shaped coins too: notice how the raised rim and the edge follow a non-round outline, but this coin has its own outline, described below.' : '')
      : '')
  );

  if (odd && hasFront) {
    sections.push(
      'SHAPE (must be the same die-cut piece of metal as IMAGE 1)\n'
      + 'This coin is NOT round: it is die-cut to the custom outline seen in IMAGE 1. The back is the same piece of metal turned over, so its silhouette is IDENTICAL to IMAGE 1. '
      + 'Trace the outline of IMAGE 1 exactly: every point, lobe, notch, tab and curve, in the same proportions, at the same size and in the same position in the frame. '
      + 'Count the points or lobes on IMAGE 1 and reproduce the same number. Do not simplify the outline into a circle, an oval, a shield or any other generic shape, and do not add or remove parts of it. '
      + 'The raised rim and the edge follow that same outline all the way around, exactly as on IMAGE 1. '
      + 'Because the coin has been turned over, an outline that is not left-right symmetric appears mirrored left to right compared with IMAGE 1, as on a real coin; the lettering and artwork on the back itself read normally. '
      + 'Fit the back artwork inside that outline; the outline never changes to fit the artwork.'
    );
  }

  if (odd && !hasFront) {
    sections.push(
      'SHAPE\n'
      + 'This coin is NOT round. It is a custom die-cut, odd-shaped coin. '
      + "If the customer's description or style notes name a shape (a shield, a star, a state outline, a badge, cut to the logo, and so on), cut the coin to exactly that outline. "
      + 'If they name none, cut the outer edge to follow the silhouette of the main artwork itself, with a metal rim around it. '
      + 'A raised rim follows the outline all the way around, the edge follows it too, and every element stays inside the outline. Do not fall back to a circle.'
    );
  }

  sections.push(
    `THIS FACE, IN THE CUSTOMER'S OWN WORDS\n"${description}"\n`
    + 'Follow that description for what goes on the coin and where. Wording in quotation marks is the exact lettering; the rest describes artwork, placement, colors and style.'
  );

  sections.push(
    'STYLE\n'
    + (style ? `The customer's style notes: "${style}". ` : '')
    + (hasFront
      ? 'The metal finish, plating, rim, border, shape and enamel colors are already settled by the front in IMAGE 1: match them exactly, whatever the notes say about them.'
      : 'Where the customer names a metal finish, colors, a border, a texture or a mood, follow it exactly. '
        + 'Where they do not: shiny gold plating, a plain raised rim with a thin engraved line inside it, bare polished metal everywhere the artwork has no color, and no decorative border.')
  );

  sections.push(
    'TEXT (must be letter-perfect)\n'
    + (phrases.length
      ? `The coin carries exactly this lettering, in exactly this capitalization; never change the case of a letter:\n`
        + phrases.map((t) => `- "${t}": ${spellOut(t)}.`).join('\n') + '\n'
        + 'Place each line where the description says (curved along the rim when it says top or bottom, straight across when it says center or under the logo). '
        + 'Render it as raised metal letters with flat polished tops in a bold, plain, evenly spaced serif typeface, big enough to read at a glance, struck from the same metal and plating as the rim: never painted or enamel-filled. '
        + 'Every letter must be complete, correctly formed and unmistakable; check each word against the spelling above, letter by letter. '
        + 'Do not abbreviate, reword, translate, repeat, mirror or decorate the lettering, and never let it run off the coin or overlap the artwork.\n'
        + 'There is NO other lettering anywhere on the coin: no dates, mottos, initials, mint marks, numbers or tiny filler text'
        + (hasLogo ? ', except lettering that is part of the logo artwork itself, which stays inside the logo exactly as drawn.' : '.')
      : 'The customer asked for no specific lettering. Do not invent any words, letters, numbers, dates or mottos'
        + (hasLogo ? '; lettering that is part of the logo artwork itself stays inside the logo exactly as drawn.' : '.'))
  );

  sections.push(
    'NOTHING ELSE ON THE COIN\n'
    + 'Apart from what the customer described, the face is clean open metal. Do not add stars, flags, eagles, laurels, banners, scrollwork, scenery, patterns or any ornament they did not ask for.'
  );

  sections.push(
    'THE PHOTO\n'
    + (hasFront
      ? `A sharp, professional product photograph of one die-struck coin in exactly the shape of IMAGE 1${odd ? ', the same custom outline traced point for point' : ''}: real metal with crisp relief, believable depth, fine surface texture and natural reflections. `
      : odd
        ? 'A sharp, professional product photograph of one odd-shaped die-struck coin, cut to the outline described above (never a circle): real metal with crisp relief, believable depth, fine surface texture and natural reflections. '
        : 'A sharp, professional product photograph of one perfectly round die-struck coin: real metal with crisp relief, believable depth, fine surface texture and natural reflections. ')
    + 'The coin is seen straight on (not tilted), centered, filling most of the frame, fully inside the frame, under soft even studio lighting on a plain dark charcoal background. '
    + 'One coin only, this face only. No hands, no stand, no other objects, no watermark, no caption.'
  );

  if (note) {
    sections.push(
      'THIS VERSION\n'
      + `The customer has already seen a version of this coin and asked for this one to be different: "${note}". `
      + 'Apply that request. Everything else above still applies: the same lettering, the same logo, the same shape, finish and photo.'
    );
  }

  if (feedback) {
    sections.push('CORRECTION\nA previous attempt at this exact coin was rejected. ' + String(feedback).slice(0, 600) + ' Fix that this time; everything above still applies.');
  }

  return { prompt: sections.join('\n\n'), phrases };
}

module.exports = {
  FINISHES, COLORS, SHAPES, COIN_SHAPES, ADDONS, RIMS,
  normalizeCoinShape, coinShapeLabel, freeText, quotedPhrases, guessFinish, buildDescribedPrompt,
  normalizeFinish, normalizeColor, normalizeShape, normalizeAddons, normalizeBorder, normalizeTexts, normalizeBackground,
  finishLabel, buildPrompt,
};
