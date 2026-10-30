'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { DATA_DIR } = require('./datadir');
const { splitCityStateZip, countryCode } = require('./address');

const ORDERS_DIR = path.join(DATA_DIR, 'orders');

function newId(prefix = 'CFA') {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function saveOrder(order) {
  fs.mkdirSync(ORDERS_DIR, { recursive: true });
  // Test orders get a TEST- id so they are easy to spot (and ignore) in ./orders
  const id = newId(order.test ? 'TEST' : 'CFA');
  const record = { id, createdAt: new Date().toISOString(), status: order.test ? 'test' : 'quote_requested', ...order };

  // Store the coin image as a file next to the JSON instead of inside it
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(order.image || '');
  if (m) {
    const ext = m[1] === 'image/svg+xml' ? 'svg' : m[1].split('/')[1];
    const imgName = `${id}.${ext}`;
    fs.writeFileSync(path.join(ORDERS_DIR, imgName), Buffer.from(m[2], 'base64'));
    record.image = imgName;
  } else {
    delete record.image;
  }

  fs.writeFileSync(path.join(ORDERS_DIR, `${id}.json`), JSON.stringify(record, null, 2));
  return record;
}

function readOrder(id) {
  try { return JSON.parse(fs.readFileSync(path.join(ORDERS_DIR, `${id}.json`), 'utf8')); } catch (_) { return null; }
}

function updateOrder(id, patch) {
  const file = path.join(ORDERS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  const record = { ...JSON.parse(fs.readFileSync(file, 'utf8')), ...patch };
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return record;
}

async function notifyWebhook(record) {
  const url = process.env.ORDER_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  } catch (e) {
    console.warn('[coin-builder] order webhook failed:', e.message);
  }
}

// The deposit Checkout asks for up front, the same rule as the company CRM: a flat amount (DEPOSIT_AMOUNT, $175) on
// quotes under a threshold (DEPOSIT_THRESHOLD, $5,000), and a share of the quote (DEPOSIT_PERCENT, 50%) from the
// threshold up. DEPOSIT_PERCENT=100 charges the whole quote line by line, and the rule is then null (no deposit).
// The team collects the balance with the proof.
function depositRule() {
  const num = (name, dflt) => {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  const percent = Math.min(100, Math.round(num('DEPOSIT_PERCENT', 50)));
  if (percent >= 100) return null;
  return { amount: Math.round(num('DEPOSIT_AMOUNT', 175) * 100) / 100, threshold: num('DEPOSIT_THRESHOLD', 5000), percent };
}

// The deposit on a quote total under the rule: { amount, balance, percent (null when flat), label }, or null when the
// whole quote is charged (no rule, or the deposit would cover the quote)
function depositOn(total, rule = depositRule()) {
  if (!rule || !(total > 0)) return null;
  const flat = total < rule.threshold;
  const amount = Math.min(total, flat ? rule.amount : Math.round(total * rule.percent) / 100);
  if (amount >= total) return null;
  return {
    amount,
    balance: Math.round((total - amount) * 100) / 100,
    percent: flat ? null : rule.percent,
    label: flat ? `$${amount.toFixed(2)} deposit` : `${rule.percent}% deposit`,
  };
}

/**
 * Create a Stripe Checkout session for an order: the deposit on the quote (see depositOn), or the whole quote
 * line by line. Returns the hosted URL or null when Stripe or pricing is not configured.
 */
async function createCheckout(record, baseUrl) {
  const key = process.env.STRIPE_SECRET_KEY;
  const q = record.quote;
  if (!key || !q || !q.priced) return null;

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${baseUrl}/?order=${record.id}&paid=1`);
  params.set('cancel_url', `${baseUrl}/?order=${record.id}&paid=0`);
  params.set('customer_email', record.email);
  params.set('client_reference_id', record.id);
  params.set('metadata[order_id]', record.id);
  // One Stripe line per line of the quote: the coins at their unit price, then the mold, add-ons, packaging, rush
  // and shipping as single items, so the receipt reads like the quote the customer saw
  let n = 0;
  const line = (name, description, unitCents, qty) => {
    params.set(`line_items[${n}][quantity]`, String(qty));
    params.set(`line_items[${n}][price_data][currency]`, 'usd');
    params.set(`line_items[${n}][price_data][unit_amount]`, String(unitCents));
    params.set(`line_items[${n}][price_data][product_data][name]`, name);
    if (description) params.set(`line_items[${n}][price_data][product_data][description]`, description);
    n++;
  };
  const deposit = depositOn(q.total);
  if (deposit) {
    line(`${deposit.percent ? deposit.label : 'Deposit'} on order ${record.id}`,
      `${record.quantity} × ${record.size}" ${q.finishLabel} coins, quoted at $${q.total.toFixed(2)}. The balance of $${deposit.balance.toFixed(2)} is due when you approve your proof.`,
      Math.round(deposit.amount * 100), 1);
  } else {
    for (const l of q.lines) {
      if (l.key === 'coins') line(`Custom ${record.size}" ${q.finishLabel} coin`, `${l.detail} · order ${record.id}`, Math.round(q.unit * 100), record.quantity);
      else if (l.amount > 0) line(l.label, l.detail, Math.round(l.amount * 100), 1);
    }
  }
  params.set('payment_intent_data[description]', `Coin Builder order ${record.id}: ${deposit ? 'deposit on ' : ''}${record.quantity} x ${record.size}" coins`);
  params.set('payment_intent_data[metadata][order_id]', record.id);
  // Where the coins are going, for the payment record and for pay-over-time lenders (Affirm), who look at it when
  // they decide on a plan. Only when the country reads as one Stripe has a code for.
  const ship = record.shipping || {};
  const country = countryCode(ship.country);
  if (country && ship.street) {
    const place = splitCityStateZip(ship.cityStateZip);
    params.set('payment_intent_data[shipping][name]', record.name);
    params.set('payment_intent_data[shipping][address][line1]', ship.street);
    if (place.City) params.set('payment_intent_data[shipping][address][city]', place.City);
    if (place.State) params.set('payment_intent_data[shipping][address][state]', place.State);
    if (place.Zip_Code) params.set('payment_intent_data[shipping][address][postal_code]', place.Zip_Code);
    params.set('payment_intent_data[shipping][address][country]', country);
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || 'Stripe error');
  updateOrder(record.id, { status: 'awaiting_payment', stripeSessionId: data.id, deposit });
  return data.url;
}

/**
 * Asks Stripe whether an order's checkout was paid, and marks the order paid when it was. The browser coming back
 * from checkout is not proof of payment, and a customer can pay and close the tab before coming back at all.
 * Returns { record, paid, justPaid } (justPaid: this call is the one that found it out), or null for an unknown order.
 */
async function confirmPayment(id) {
  const record = readOrder(id);
  if (!record) return null;
  if (record.status === 'paid') return { record, paid: true, justPaid: false };
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !record.stripeSessionId) return { record, paid: false, justPaid: false };
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(record.stripeSessionId)}`, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
  });
  const session = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((session.error && session.error.message) || `Stripe answered ${res.status}`);
  if (session.payment_status !== 'paid') return { record, paid: false, justPaid: false };
  const paid = updateOrder(id, {
    status: 'paid', paidAt: new Date().toISOString(),
    amountPaid: typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
    stripePaymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
  });
  return { record: paid, paid: true, justPaid: true };
}

// The ids of recent orders that were sent to checkout and have not been seen paid (today's and yesterday's: a
// checkout page stops working a day after it was made)
function awaitingPayment() {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  const recent = [day(Date.now()), day(Date.now() - 864e5)];
  let files = [];
  try { files = fs.readdirSync(ORDERS_DIR); } catch (_) { return []; }
  return files
    .filter((f) => /^CFA-\d{8}-[0-9A-F]{6}\.json$/.test(f) && recent.includes(f.slice(4, 12)))
    .map((f) => readOrder(f.slice(0, -5)))
    .filter((o) => o && o.stripeSessionId && ['awaiting_payment', 'paid_pending_verification', 'payment_cancelled'].includes(o.status))
    .map((o) => o.id);
}

module.exports = { saveOrder, updateOrder, notifyWebhook, createCheckout, confirmPayment, awaitingPayment, depositRule, depositOn };
