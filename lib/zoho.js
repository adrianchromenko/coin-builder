'use strict';

/**
 * Zoho CRM: every quote request becomes a Lead, with the coin in the description and the render attached, so the
 * sales team works it from the CRM like the leads from the website's quote form.
 *
 * Setup (once): make a Self Client at https://api-console.zoho.com, generate a grant code with the scopes
 *   ZohoCRM.modules.leads.CREATE,ZohoCRM.modules.attachments.CREATE
 * and run  node scripts/zoho-token.js <client id> <client secret> <grant code>  within ten minutes to turn it into
 * the refresh token. Then set in .env:
 *   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
 *   ZOHO_ACCOUNTS_URL   https://accounts.zoho.com (US, the default); .eu, .in, .com.au, .jp for other data centers
 *   ZOHO_LEAD_SOURCE    the Lead Source to stamp on these leads (default "Coin Builder")
 *   ZOHO_OWNERS         the sales reps' CRM user ids, comma separated: the leads are dealt out to them in turn.
 *                       Without it every lead belongs to whoever made the Self Client.
 * Without the three credentials nothing here runs, and orders are still saved and emailed as before.
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./datadir');
const { splitCityStateZip } = require('./address');

const ACCOUNTS = () => (process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com').replace(/\/$/, '');
const VERSION = () => process.env.ZOHO_API_VERSION || 'v8';

function configured() {
  return !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN);
}

// Access tokens last an hour; one is kept and renewed a little before it runs out
let token = { value: '', apiDomain: '', expires: 0 };
async function accessToken() {
  if (token.value && Date.now() < token.expires - 60000) return token;
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${ACCOUNTS()}/oauth/v2/token`, { method: 'POST', body: params, signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Zoho token refresh failed: ${data.error || res.status}`);
  token = { value: data.access_token, apiDomain: (data.api_domain || 'https://www.zohoapis.com').replace(/\/$/, ''), expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return token;
}

async function api(path, { method = 'POST', body, headers = {} } = {}) {
  const t = await accessToken();
  const res = await fetch(`${t.apiDomain}/crm/${VERSION()}${path}`, {
    method,
    headers: { Authorization: `Zoho-oauthtoken ${t.value}`, ...headers },
    body,
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  const first = Array.isArray(data.data) ? data.data[0] : null;
  if (!res.ok || (first && first.status === 'error')) {
    const detail = first ? `${first.code}: ${first.message}${first.details ? ' ' + JSON.stringify(first.details) : ''}` : `${data.code || res.status}: ${data.message || ''}`;
    throw new Error(`Zoho ${method} ${path} failed (${detail.trim()})`);
  }
  return data;
}

// Round robin: each lead goes to the rep after the one who got the last. Who that was is kept in
// DATA_DIR/zoho-owner.json so the turn survives restarts; with nothing saved, the first rep is picked at random.
const OWNER_FILE = path.join(DATA_DIR, 'zoho-owner.json');
const owners = () => (process.env.ZOHO_OWNERS || '').split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
let lastOwner = null;
function nextOwner() {
  const list = owners();
  if (!list.length) return null;
  if (lastOwner === null) {
    try { lastOwner = String(JSON.parse(fs.readFileSync(OWNER_FILE, 'utf8')).last || ''); } catch (_) { lastOwner = ''; }
  }
  const at = list.indexOf(lastOwner);
  lastOwner = list[at === -1 ? Math.floor(Math.random() * list.length) : (at + 1) % list.length];
  try { fs.writeFileSync(OWNER_FILE, JSON.stringify({ last: lastOwner })); } catch (e) { console.warn('[coin-builder] could not save the Zoho lead rotation:', e.message); }
  return lastOwner;
}

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { Last_Name: parts[0] || 'Unknown' };
  return { First_Name: parts.slice(0, -1).join(' '), Last_Name: parts[parts.length - 1] };
}

// The coin in words, for the lead's description
function describeOrder(order) {
  const d = order.design || {};
  const back = d.back || (d.backMode === 'blank' ? 'Blank (plain metal)' : 'Same design as the front');
  const lines = [
    `COIN BUILDER LEAD: this customer designed a coin on the online Coin Builder and asked for a quote (${order.id}).`,
    `Quantity: ${order.quantity}`,
    `Size: ${order.sizeLabel || order.size}${d.shape === 'odd' ? ' (longest side, odd shaped)' : ''}`,
    `Shape: ${d.shapeLabel || d.shape || 'round'}`,
    `Front: ${d.front || ''}`,
    `Back: ${back}`,
    d.style ? `Style notes: ${d.style}` : '',
    d.logoName ? `Logo file: ${d.logoName}` : '',
    (d.refNames || []).length ? `Reference images: ${d.refNames.join(', ')}` : '',
    (d.backRefNames || []).length ? `Reference images, back: ${d.backRefNames.join(', ')}` : '',
    `Artwork: ${d.aiRendered ? `AI render${d.aiWordingChecked === false ? ' (proofreader flagged the lettering)' : ''}` : 'none'}`,
    order.estimate ? `Estimate shown: $${order.estimate.total} ($${order.estimate.unit} each)` : 'No price shown (quote requested)',
    order.notes ? `Notes from the customer: ${order.notes}` : '',
    order.shipping && (order.shipping.street !== order.billing.street || order.shipping.cityStateZip !== order.billing.cityStateZip)
      ? `Ship to: ${order.shipping.street}, ${order.shipping.cityStateZip}, ${order.shipping.country}` : 'Ship to: same as billing',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * Creates the Lead for a saved order record and attaches the coin image (PNG buffer, or null).
 * Returns { leadId, attached, owner }. Throws when Zoho refuses, so the caller can record that on the order.
 */
async function createLead(order, image) {
  const bill = order.billing || {};
  const owner = nextOwner();
  const lead = {
    Owner: owner ? { id: owner } : undefined,
    ...splitName(order.name),
    Company: order.company || order.name,
    Email: order.email,
    Phone: order.phone || undefined,
    Lead_Source: process.env.ZOHO_LEAD_SOURCE || 'Coin Builder',
    Description: describeOrder(order).slice(0, 32000),
    Street: bill.street || undefined,
    ...splitCityStateZip(bill.cityStateZip),
    Country: bill.country || undefined,
  };
  for (const k of Object.keys(lead)) if (lead[k] === undefined || lead[k] === '') delete lead[k];
  const body = { data: [lead], trigger: ['approval', 'workflow', 'blueprint'] };
  const created = await api('/Leads', { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const leadId = created.data[0].details.id;

  let attached = false;
  if (image) {
    try {
      const form = new FormData();
      form.append('file', new Blob([image], { type: 'image/png' }), `${order.id}-coin.png`);
      await api(`/Leads/${leadId}/Attachments`, { body: form });
      attached = true;
    } catch (e) {
      console.warn(`[coin-builder] Zoho lead ${leadId} created, but the render could not be attached: ${e.message}`);
    }
  }
  return { leadId, attached, owner };
}

module.exports = { configured, createLead, describeOrder, nextOwner, splitCityStateZip, splitName };
