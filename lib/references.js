'use strict';

const fs = require('fs');
const path = require('path');

// Only references/coins/ is read. The folder above it collects downloads, logos and other strays on a working
// machine, and anything in the pool is shown to the AI as "a coin we made", so the pool has to be a place
// nothing lands in by accident.
const REF_DIR = path.join(__dirname, '..', 'references', 'coins');
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function listImages(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && IMAGE_RE.test(d.name))
      .map((d) => path.join(dir, d.name));
  } catch (_) {
    return [];
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick up to `count` reference coin photos for a finish. Photos in
 * references/coins/<finish>/ are preferred; photos in references/coins/ fill the rest.
 * Returns [{ buffer, mimetype, name }].
 */
function pickReferences(finish, count) {
  const n = Number(count);
  if (!n || n <= 0) return [];

  const preferred = shuffle(listImages(path.join(REF_DIR, finish)));
  const general = shuffle(listImages(REF_DIR));
  const chosen = preferred.slice(0, n);
  for (const p of general) {
    if (chosen.length >= n) break;
    if (!chosen.includes(p)) chosen.push(p);
  }

  return chosen.map((p) => ({
    buffer: fs.readFileSync(p),
    mimetype: MIME[path.extname(p).toLowerCase()] || 'image/jpeg',
    name: path.basename(p),
    ext: path.extname(p).toLowerCase(),
  }));
}

function countReferences() {
  let total = listImages(REF_DIR).length;
  try {
    for (const d of fs.readdirSync(REF_DIR, { withFileTypes: true })) {
      // Folders starting with "_" (e.g. _unused) are parked files, not references
      if (d.isDirectory() && !d.name.startsWith('_')) total += listImages(path.join(REF_DIR, d.name)).length;
    }
  } catch (_) {}
  return total;
}

module.exports = { pickReferences, countReferences, REF_DIR };
