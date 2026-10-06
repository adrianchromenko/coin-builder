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
 *   ZOHO_LEAD_SOURCE    the Lead Source picklist value to stamp on these leads (default "Coin Builder"; it has to
 *                       exist in the picklist, or Zoho refuses the record)
 *   ZOHO_ASSIGNMENT     "1" to run the CRM's lead assignment rules (round-robin to the reps) on each new lead
 * Without the three credentials nothing here runs, and orders are still saved and emailed as before.
 */

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

// "Austin, TX 78701" -> city, state, zip. Anything that does not read that way goes in whole as the city.
function splitCityStateZip(s) {
  const m = /^\s*(.+?)\s*,\s*([A-Za-z .]+?)\s+([A-Za-z0-9 -]{3,10})\s*$/.exec(s || '');
  return m ? { City: m[1], State: m[2].trim(), Zip_Code: m[3] } : { City: (s || '').trim() };
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
    `Coin Builder quote request ${order.id}`,
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
 * Returns { leadId, attached }. Throws when Zoho refuses, so the caller can record that on the order.
 */
async function createLead(order, image) {
  const bill = order.billing || {};
  const lead = {
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
  if (process.env.ZOHO_ASSIGNMENT === '1') body.apply_feature_execution = [{ name: 'assignment_rules' }];
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
  return { leadId, attached };
}

module.exports = { configured, createLead, describeOrder, splitCityStateZip, splitName };
