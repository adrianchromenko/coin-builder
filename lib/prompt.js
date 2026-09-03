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

function buildPrompt({ finish, notes }) {
  const plating = finishLabel(finish);
  let prompt =
    'Turn the artwork in this image into a photorealistic custom minted challenge coin. ' +
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
