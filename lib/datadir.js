'use strict';

/**
 * Where saved files live: orders, leads, clean renders, email images.
 * DATA_DIR points them at a persistent disk on hosts that wipe the app folder on each deploy (Render).
 * Checked once at startup: if that folder cannot be written to, the app says so loudly and falls back to
 * the app folder rather than failing every render (which would still cost an OpenAI call each time).
 */

const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');

function pickDataDir() {
  const wanted = process.env.DATA_DIR;
  if (!wanted) return APP_DIR;
  try {
    fs.mkdirSync(wanted, { recursive: true });
    fs.accessSync(wanted, fs.constants.W_OK);
    const probe = path.join(wanted, '.write-test');
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return wanted;
  } catch (e) {
    console.error(`[coin-builder] DATA_DIR=${wanted} is not writable (${e.code || e.message}). Check the persistent disk and its mount path. ` +
      `Saving to the app folder instead: files there are LOST on the next deploy or restart.`);
    return APP_DIR;
  }
}

const DATA_DIR = pickDataDir();
module.exports = { DATA_DIR };
