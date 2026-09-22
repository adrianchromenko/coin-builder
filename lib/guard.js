'use strict';

/**
 * Keeps strangers from running up the OpenAI bill. Every AI render costs real money (about 10-20 cents),
 * whether or not the visitor ever orders, so the /api/generate route is guarded in layers:
 *
 *  1. One render at a time per visitor (a script firing 20 requests at once gets 19 refusals).
 *  2. Per-visitor caps: RENDERS_PER_HOUR and RENDERS_PER_DAY per IP address.
 *  3. A site-wide daily budget: RENDERS_PER_DAY_TOTAL. Once it is spent, nobody renders until midnight (ET)
 *     and the team is emailed. That is the hard ceiling on what a bad day can cost. The count survives
 *     restarts: it is kept in DATA_DIR/render-count.json.
 *  4. Repeats are free: the exact same proof with the exact same options within 24 hours returns the
 *     earlier result instead of paying OpenAI again.
 *  5. Optional: Cloudflare Turnstile (TURNSTILE_SITE_KEY + TURNSTILE_SECRET) makes each render prove it came
 *     from a real browser, which stops scripted abuse from rotating IP addresses.
 *
 * Per-visitor counters live in memory and reset on restart; that is fine because the daily total does not.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./datadir');

const num = (name, dflt) => { const v = Number(process.env[name]); return Number.isFinite(v) && v >= 0 ? v : dflt; };
const PER_HOUR = () => num('RENDERS_PER_HOUR', 10);
const PER_DAY = () => num('RENDERS_PER_DAY', 25);
const PER_DAY_TOTAL = () => num('RENDERS_PER_DAY_TOTAL', 300);
const WARN_AT = 0.8; // email the team when this share of the daily budget is spent

const HOUR = 3600000;
const DAY = 86400000;

// ---------- per-visitor ----------
const byIp = new Map(); // ip -> { times: [ms], busy: boolean }

function visitor(ip) {
  let v = byIp.get(ip);
  if (!v) { v = { times: [], busy: false }; byIp.set(ip, v); }
  const cutoff = Date.now() - DAY;
  v.times = v.times.filter((t) => t > cutoff);
  return v;
}

// Drop visitors nobody has heard from in a day, so the map cannot grow forever
setInterval(() => {
  const cutoff = Date.now() - DAY;
  for (const [ip, v] of byIp) if (!v.busy && !v.times.some((t) => t > cutoff)) byIp.delete(ip);
}, HOUR).unref();

// ---------- site-wide daily total ----------
const COUNT_FILE = path.join(DATA_DIR, 'render-count.json');
const dayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD in ET

function readTotal() {
  try {
    const d = JSON.parse(fs.readFileSync(COUNT_FILE, 'utf8'));
    if (d && d.day === dayKey()) return d;
  } catch (_) {}
  return { day: dayKey(), count: 0, warned: false, exhausted: false };
}
function writeTotal(d) {
  try { fs.writeFileSync(COUNT_FILE, JSON.stringify(d)); } catch (e) { console.warn('[coin-builder] could not save render count:', e.message); }
}

let alert = null; // async (subject, text) => void, set by the server once mail is configured
function onAlert(fn) { alert = fn; }
function notify(subject, text) {
  console.error(`[coin-builder] ${subject}: ${text}`);
  if (alert) alert(subject, text).catch((e) => console.warn('[coin-builder] alert email failed:', e.message));
}

// ---------- repeat detection ----------
const MAX_CACHED = 100;
const cache = new Map(); // fingerprint -> { at, response }

function fingerprint(buffer, options) {
  return crypto.createHash('sha256').update(buffer).update(JSON.stringify(options)).digest('hex');
}
function cached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > DAY) { cache.delete(key); return null; }
  return hit.response;
}
function remember(key, response) {
  cache.set(key, { at: Date.now(), response });
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
}

// ---------- Turnstile ----------
const turnstileOn = () => !!(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET);

async function verifyTurnstile(token, ip) {
  if (!turnstileOn()) return true;
  if (!token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: process.env.TURNSTILE_SECRET, response: String(token).slice(0, 4096), remoteip: ip }),
      signal: AbortSignal.timeout(10000),
    });
    const out = await r.json().catch(() => ({}));
    return out.success === true;
  } catch (e) {
    console.warn('[coin-builder] Turnstile check failed:', e.message);
    return false;
  }
}

/**
 * Decide whether this visitor may spend a render right now (`renders` of them: a two-sided coin is two). On success the render is counted immediately
 * (a request that reaches OpenAI costs money even if it fails later) and the visitor is marked busy; the
 * caller MUST call release(ip) when the render finishes. Returns { ok: true } or { ok: false, status, error }.
 */
function admit(ip, renders = 1) {
  const v = visitor(ip);
  const now = Date.now();
  if (v.busy) return { ok: false, status: 429, error: 'Your previous coin is still rendering. Please wait for it to finish.' };
  if (v.times.filter((t) => t > now - HOUR).length >= PER_HOUR()) {
    return { ok: false, status: 429, error: 'You have rendered a lot of coins in the last hour. Please take a short break and try again later.' };
  }
  if (v.times.length >= PER_DAY()) {
    return { ok: false, status: 429, error: 'You have reached today\'s limit for AI renders. Email us your design and our artists will take it from here.' };
  }

  const total = readTotal();
  if (total.count >= PER_DAY_TOTAL()) {
    if (!total.exhausted) {
      total.exhausted = true;
      writeTotal(total);
      notify('Coin Builder: daily render budget spent',
        `All ${PER_DAY_TOTAL()} AI renders allowed today (${total.day}) have been used. Renders are paused until midnight ET. ` +
        'Raise RENDERS_PER_DAY_TOTAL if this was real demand, or check the logs for one visitor hammering the site.');
    }
    return { ok: false, status: 503, error: 'AI rendering is taking a rest for today. Your layout still works as your coin, and you can email it to us for a quote.' };
  }

  total.count += renders;
  if (!total.warned && total.count >= Math.ceil(PER_DAY_TOTAL() * WARN_AT)) {
    total.warned = true;
    notify('Coin Builder: 80% of today\'s render budget used',
      `${total.count} of ${PER_DAY_TOTAL()} AI renders have been used today (${total.day}). Rendering pauses for everyone when the limit is reached.`);
  }
  writeTotal(total);

  v.busy = true;
  v.times.push(now);
  return { ok: true };
}

function release(ip) {
  const v = byIp.get(ip);
  if (v) v.busy = false;
}

function limits() {
  return { perHour: PER_HOUR(), perDay: PER_DAY(), perDayTotal: PER_DAY_TOTAL(), usedToday: readTotal().count, turnstile: turnstileOn() };
}

module.exports = { admit, release, fingerprint, cached, remember, verifyTurnstile, turnstileOn, onAlert, limits };
