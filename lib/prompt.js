'use strict';

const FINISHES = {
  gold: 'polished gold plating',
  silver: 'polished silver plating',
  copper: 'polished copper plating',
  'antique-gold': 'antique gold plating with darkened recesses',
  'antique-silver': 'antique silver plating with darkened recesses',
  'black-nickel': 'black nickel plating',
};

function finishLabel(key) {
  return FINISHES[key] || FINISHES.gold;
}

function buildPrompt({ finish, notes, referenceCount = 0 }) {
  const plating = finishLabel(finish);
  let prompt =
    (referenceCount > 0
      ? "IMAGE 1 is the customer's artwork and is the ONLY design to reproduce. " +
        'Images 2 to ' + (referenceCount + 1) + ' are photos of unrelated coins we have manufactured; ' +
        'use them ONLY as a style reference for metal finish, rim and edge treatment, relief depth, ' +
        'enamel look, lighting and photography. Do NOT copy any logo, text, emblem, or layout from those reference coins. '
      : '') +
    "Turn the customer's artwork into a photorealistic custom minted challenge coin. " +
    'Reproduce the design faithfully as raised, embossed relief on the face of a round metal coin with ' +
    plating + '. ' +
    'Include a raised rim around the edge, crisp engraved detail, a subtle reeded edge, ' +
    'and realistic metallic reflections. Keep any text from the original legible. ' +
    'Show the coin face-on, centered, filling most of the frame, with soft studio lighting ' +
    'on a plain dark charcoal background. No hands, no extra objects, no watermark.';
  if (notes && notes.trim()) {
    prompt += ' Additional customer instructions: ' + notes.trim().slice(0, 500);
  }
  return prompt;
}

module.exports = { FINISHES, finishLabel, buildPrompt };
