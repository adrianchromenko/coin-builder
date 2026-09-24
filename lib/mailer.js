'use strict';

/**
 * Emails a customer their (watermarked) coin design, and records them as a lead.
 *
 * Simplest: a Brevo API key (sent over HTTPS, so it works on hosts that block SMTP ports):
 *   BREVO_API_KEY=xkeysib-...  MAIL_FROM="Coins for Anything <designs@yourdomain.com>"
 * Or any SMTP account (Brevo, Zoho Mail, Google Workspace, SendGrid...):
 *   SMTP_HOST=smtp-relay.brevo.com  SMTP_PORT=587  SMTP_USER=xxxxxxx@smtp-brevo.com  SMTP_PASS=smtp-key
 * MAIL_PREVIEW_DIR=some/folder writes each message to a .eml file there instead of sending it, for testing.
 */

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const { DATA_DIR } = require('./datadir');

const LEADS_DIR = path.join(DATA_DIR, 'leads');

const previewDir = () => process.env.MAIL_PREVIEW_DIR || '';
const brevoKey = () => (previewDir() ? '' : process.env.BREVO_API_KEY || '');
const mailConfigured = () => !!(previewDir() || brevoKey() || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS));

// "Name <addr@x.com>" or "addr@x.com" -> { name, email }
function parseAddress(s) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(String(s || ''));
  if (m) return m[1] ? { name: m[1], email: m[2].trim() } : { email: m[2].trim() };
  return { email: String(s || '').trim() };
}

const fromAddress = () => process.env.MAIL_FROM || process.env.SMTP_USER || 'Coins for Anything <no-reply@localhost>';

/**
 * Sends one message through Brevo's API, or SMTP when that is what is configured.
 * to: [{ email, name? }], attachments: [{ filename, content (Buffer), contentType, cid? }]
 */
async function deliver({ to, replyTo, subject, text, html, attachments = [] }) {
  if (brevoKey()) {
    const body = {
      sender: parseAddress(fromAddress()),
      to: to.map((t) => (t.name ? { email: t.email, name: t.name } : { email: t.email })),
      subject,
      htmlContent: html,
      textContent: text,
    };
    if (attachments.length) body.attachment = attachments.map((a) => ({ name: a.filename, content: a.content.toString('base64') }));
    if (replyTo) body.replyTo = parseAddress(replyTo);
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': brevoKey(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Brevo ${r.status}: ${out.message || out.code || 'request failed'}`);
    return out;
  }
  const info = await getTransport().sendMail({
    from: fromAddress(),
    to: to.map((t) => (t.name ? `"${t.name.replace(/"/g, '')}" <${t.email}>` : t.email)).join(', '),
    replyTo: replyTo || undefined,
    subject,
    text,
    html,
    attachments,
  });
  if (previewDir()) {
    fs.mkdirSync(previewDir(), { recursive: true });
    fs.writeFileSync(path.join(previewDir(), `${subject.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}-${Date.now()}.eml`), info.message);
  }
  return info;
}

let transport = null;
function getTransport() {
  if (transport) return transport;
  if (previewDir()) {
    transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  } else {
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // 465 = TLS from the start; 587 upgrades with STARTTLS
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transport;
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));


// ---------- new-order email to the team ----------
// ORDER_NOTIFY_TO: comma-separated list of staff addresses that get every order (with the coin image attached)
const DEFAULT_ORDER_NOTIFY_TO = 'bart@primarydm.com,chris@coinsforanything.com,jeff@coinsforanything.com';
const orderNotifyTo = () => (process.env.ORDER_NOTIFY_TO ?? DEFAULT_ORDER_NOTIFY_TO).split(',').map((s) => s.trim()).filter(Boolean);

/**
 * order: the saved order record. image: the coin image buffer (clean original for AI renders), or null.
 */
async function sendOrderEmail(order, image) {
  const to = orderNotifyTo();
  if (!to.length || !mailConfigured()) return null;
  const d = order.design || {};
  const bg = d.background || {};
  const est = order.estimate;
  const rows = [
    ['Order', order.id],
    ['Placed', new Date(order.createdAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET'],
    ['Quantity', `${order.quantity} coins`],
    ['Size', `${order.size}"${d.shape === 'odd' ? ' (longest side, odd shaped)' : ''}`],
    ['Shape', d.shapeLabel],
    ['Front, in their words', d.front],
    ['Back, in their words', d.back || 'Same design as the front'],
    ['Style notes', d.style],
    ['Logo file', d.logoName],
    ['Artwork', d.aiRendered ? `AI render${d.aiWordingChecked === false ? ' (proofreader flagged the lettering: check it)' : ''}` : 'Customer layout'],
    ['Estimate', est ? `$${est.total} (${order.quantity} x $${est.unitPrice})` : 'Quote requested (no price shown)'],
    ['', ''],
    ['Name', order.name],
    ['Company', order.company],
    ['Email', order.email],
    ['Phone', order.phone],
    ['Ship to', [order.shipping?.street, order.shipping?.cityStateZip, order.shipping?.country].filter(Boolean).join(', ')],
    ['Bill to', [order.billing?.street, order.billing?.cityStateZip, order.billing?.country].filter(Boolean).join(', ')],
    ['Notes', order.notes],
  ].filter(([k, v]) => k === '' || v);

  const html = `<!doctype html><html><body style="margin:0;background:#F5F1EA;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EA"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
  <tr><td style="background:#1A1A1A;border-bottom:4px solid #F58220;padding:18px 28px;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:2px">NEW COIN ORDER</td></tr>
  <tr><td style="padding:28px">
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4A4A4A">A customer sent a coin design for review from the Coin Builder. The artwork is attached.</p>
    <table role="presentation" cellpadding="0" cellspacing="0">${rows.map(([k, v]) => k === ''
      ? '<tr><td colspan="2" style="padding:8px 0"><hr style="border:0;border-top:1px solid #E5E0D8;margin:0"></td></tr>'
      : `<tr><td style="padding:6px 14px 6px 0;color:#777;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#222;font-size:14px">${esc(v)}</td></tr>`).join('')}</table>
    <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#777">Reply to this email to answer the customer directly.</p>
  </td></tr>
</table></td></tr></table></body></html>`;
  const text = `New coin order from the Coin Builder. The artwork is attached.\n\n` + rows.map(([k, v]) => (k === '' ? '' : `${k}: ${v}`)).join('\n');

  const attachments = image ? [{ filename: `${order.id}.png`, content: image, contentType: 'image/png' }] : [];
  return deliver({
    to: to.map((email) => ({ email })),
    replyTo: order.email,
    subject: `New coin order ${order.id}: ${order.quantity} x ${order.size}" ${order.finishLabel || order.finish} for ${order.name}`,
    text,
    html,
    attachments,
  });
}

// One JSON file per lead, so nothing is lost if the webhook or the CRM is down,
// plus one line in signups.csv: the simple list of everyone who asked for their design by email
const SIGNUPS_CSV = path.join(LEADS_DIR, 'signups.csv');
const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

function saveLead(lead) {
  fs.mkdirSync(LEADS_DIR, { recursive: true });
  const record = { createdAt: new Date().toISOString(), ...lead };
  const stamp = record.createdAt.replace(/[-:.TZ]/g, '').slice(0, 14);
  fs.writeFileSync(path.join(LEADS_DIR, `${stamp}-${Math.random().toString(16).slice(2, 8)}.json`), JSON.stringify(record, null, 2));
  if (!record.test) {
    if (!fs.existsSync(SIGNUPS_CSV)) fs.writeFileSync(SIGNUPS_CSV, 'date,name,email,newsletter,emailed,top text,center text,bottom text\r\n');
    const d = record.design || {};
    const line = [record.createdAt.slice(0, 16).replace('T', ' '), record.name, record.email, record.newsletter ? 'yes' : 'no',
      record.emailed ? 'yes' : 'no', d['Top text'], d['Center text'], d['Bottom text']].map(csvCell).join(',');
    fs.appendFileSync(SIGNUPS_CSV, line + '\r\n');
  }
  return record;
}

function readSignupsCsv() {
  try { return fs.readFileSync(SIGNUPS_CSV); } catch (_) { return null; }
}

// Optional: POST every lead to LEAD_WEBHOOK_URL (Zapier, Make, Zoho Flow -> CRM)
async function notifyLead(record) {
  const url = process.env.LEAD_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'design_emailed', ...record }) });
  } catch (e) {
    console.warn('[coin-builder] lead webhook failed:', e.message);
  }
}

/**
 * "Contact us to fix my design": the customer's message goes to the team with their render attached (watermarked by
 * the caller) and the design as they described it, so the artists can pick it up without asking again.
 */
async function sendContactEmail({ name, email, phone, message, design, image }) {
  const to = orderNotifyTo().map((addr) => ({ email: addr }));
  if (!to.length || !mailConfigured()) return null;
  const d = design || {};
  const rows = [
    ['Name', name], ['Email', email], ['Phone', phone],
    ['Message', message],
    ['', ''],
    ['Shape', d.shapeLabel], ['Front, in their words', d.front], ['Back, in their words', d.back], ['Style notes', d.style], ['Logo file', d.logoName],
  ].filter(([k, v]) => k === '' || v);
  const html = `<!doctype html><html><body style="margin:0;background:#F5F1EA;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EA"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
  <tr><td style="background:#1A1A1A;border-bottom:4px solid #F58220;padding:18px 28px;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:2px">DESIGN HELP REQUEST</td></tr>
  <tr><td style="padding:28px">
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4A4A4A">A customer of the Coin Builder asked for help with their design.${image ? ' Their latest AI render is attached.' : ''}</p>
    <table role="presentation" cellpadding="0" cellspacing="0">${rows.map(([k, v]) => k === ''
      ? '<tr><td colspan="2" style="padding:8px 0"><hr style="border:0;border-top:1px solid #E5E0D8;margin:0"></td></tr>'
      : `<tr><td style="padding:6px 14px 6px 0;color:#777;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#222;font-size:14px">${esc(v)}</td></tr>`).join('')}</table>
    <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#777">Reply to this email to answer the customer directly.</p>
  </td></tr>
</table></td></tr></table></body></html>`;
  const text = 'Design help request from the Coin Builder.\n\n' + rows.map(([k, v]) => (k === '' ? '' : `${k}: ${v}`)).join('\n');
  return deliver({
    to, replyTo: email,
    subject: `Coin Builder: ${name || email} needs help with their design`,
    text, html,
    attachments: image ? [{ filename: 'design-render.png', content: image, contentType: 'image/png' }] : [],
  });
}

/** Plain-text heads-up to the team (same recipients as order emails). Used for the daily render budget warnings. */
async function sendAlertEmail(subject, text) {
  const to = orderNotifyTo().map((email) => ({ email }));
  if (!to.length || !mailConfigured()) return null;
  return deliver({ to, subject, text, html: `<p>${esc(text)}</p>` });
}

module.exports = { mailConfigured, sendOrderEmail, sendAlertEmail, sendContactEmail, saveLead, readSignupsCsv, notifyLead };
