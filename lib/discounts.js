'use strict';

/**
 * Discount codes for the quote form. DISCOUNT_CODES in .env lists them as CODE:percent, comma separated
 * (e.g. "CFATEST100:100,WELCOME10:10"). Unless set, the one code is CFATEST100 at 100% off, which the team uses to
 * run an order all the way through on the live site without paying; DISCOUNT_CODES= (empty) turns codes off.
 * The discount comes off the whole order (shipping and tax included), and a 100% code skips Stripe altogether.
 */
function codes() {
  const raw = process.env.DISCOUNT_CODES;
  const src = raw == null ? 'CFATEST100:100' : raw;
  const out = {};
  for (const part of src.split(',')) {
    const [code, pct] = part.split(':').map((s) => String(s || '').trim());
    const percent = Number(pct);
    if (/^[A-Z0-9-]{3,30}$/i.test(code) && Number.isFinite(percent) && percent > 0 && percent <= 100) {
      out[code.toUpperCase()] = Math.round(percent * 100) / 100;
    }
  }
  return out;
}

// What a code as typed is worth: null when nothing was typed, { code, valid: false } for a code that is not on the
// list (the form says so), { code, valid: true, percent } for one that is
function discountFor(typed) {
  const code = String(typed || '').trim().toUpperCase().slice(0, 30);
  if (!code) return null;
  const percent = codes()[code];
  return percent ? { code, valid: true, percent } : { code, valid: false, percent: 0 };
}

module.exports = { discountFor, codes };
