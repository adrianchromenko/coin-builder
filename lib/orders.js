'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { estimate } = require('./pricing');

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

/**
 * Create a Stripe Checkout session for an order. Returns the hosted URL or
 * null when Stripe or pricing is not configured.
 */
async function createCheckout(record, baseUrl) {
  const key = process.env.STRIPE_SECRET_KEY;
  const price = estimate(record.size, record.quantity);
  if (!key || !price) return null;

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${baseUrl}/?order=${record.id}&paid=1`);
  params.set('cancel_url', `${baseUrl}/?order=${record.id}&paid=0`);
  params.set('customer_email', record.email);
  params.set('client_reference_id', record.id);
  params.set('metadata[order_id]', record.id);
  params.set('line_items[0][quantity]', String(record.quantity));
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(Math.round(price.unit * 100)));
  params.set('line_items[0][price_data][product_data][name]', `Custom ${record.size}" ${record.finishLabel} Coin`);
  params.set('line_items[0][price_data][product_data][description]', `Order ${record.id}`);
  params.set('payment_intent_data[description]', `Coin Builder order ${record.id}: ${record.quantity} x ${record.size}" coins`);
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
  updateOrder(record.id, { status: 'awaiting_payment', stripeSessionId: data.id });
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

module.exports = { saveOrder, updateOrder, notifyWebhook, createCheckout, confirmPayment, awaitingPayment };
