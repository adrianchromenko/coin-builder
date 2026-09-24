'use strict';

const fs = require('fs');
const path = require('path');

// Only references/coins/ is read. The folder above it collects downloads, logos and other strays on a working
// machine, and anything in the pool is shown to the AI as "a coin we made", so the pool has to be a place
// nothing lands in by accident.
const REF_DIR = path.join(__dirname, '..', 'references', 'coins');
// Photos of coins that are not round live here. They are shown only for odd-shaped orders, and never for round ones:
// a round coin drawn from a peach-shaped reference comes out lopsided.
const ODD_DIR = path.join(REF_DIR, 'odd-shaped');
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
 * For an odd-shaped coin (`odd: true`) only references/coins/odd-shaped/ is used, so the AI sees how a rim and
 * edge follow a non-round outline; round photos are used only if that folder is empty, so a render still happens.
 * Returns [{ buffer, mimetype, name }].
 */
function pickReferences(finish, count, { odd = false } = {}) {
  const n = Number(count);
  if (!n || n <= 0) return [];

  let chosen;
  if (odd) {
    const preferred = shuffle(listImages(path.join(ODD_DIR, finish)));
    const general = shuffle(listImages(ODD_DIR));
    chosen = preferred.slice(0, n);
    for (const p of general) {
      if (chosen.length >= n) break;
      if (!chosen.includes(p)) chosen.push(p);
    }
    if (chosen.length) return load(chosen);
  }

  const preferred = shuffle(listImages(path.join(REF_DIR, finish)));
  const general = shuffle(listImages(REF_DIR));
  chosen = preferred.slice(0, n);
  for (const p of general) {
    if (chosen.length >= n) break;
    if (!chosen.includes(p)) chosen.push(p);
  }
  return load(chosen);
}

function load(paths) {
  return paths.map((p) => ({
    buffer: fs.readFileSync(p),
    mimetype: MIME[path.extname(p).toLowerCase()] || 'image/jpeg',
    name: path.basename(p),
    ext: path.extname(p).toLowerCase(),
  }));
}

/**
 * Load reference photos by file name (as returned in a previous pick), so a second render of the same coin is shown
 * exactly the same factory photos. Names that no longer exist are skipped.
 */
function loadReferences(names) {
  const wanted = new Set((names || []).map(String));
  if (!wanted.size) return [];
  return load(allImages().filter((p) => wanted.has(path.basename(p))));
}

// Every reference photo: coins/, its finish folders, odd-shaped/ and the finish folders inside that.
// Folders starting with "_" (e.g. _unused) are parked files, not references.
function allImages() {
  const all = [];
  const walk = (dir) => {
    all.push(...listImages(dir));
    try {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (d.isDirectory() && !d.name.startsWith('_')) walk(path.join(dir, d.name));
      }
    } catch (_) {}
  };
  walk(REF_DIR);
  return all;
}

function countReferences() {
  return allImages().length;
}

module.exports = { pickReferences, loadReferences, countReferences, REF_DIR, ODD_DIR };
