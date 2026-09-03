'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { estimate } = require('./pricing');

const ORDERS_DIR = path.join(__dirname, '..', 'orders');

function newId() {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 10).replace(/-/g, '');
  return `CFA-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function saveOrder(order) {
  fs.mkdirSync(ORDERS_DIR, { recursive: true });
  const id = newId();
  const record = { id, createdAt: new Date().toISOString(), status: 'quote_requested', ...order };

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

module.exports = { saveOrder, updateOrder, notifyWebhook, createCheckout };
