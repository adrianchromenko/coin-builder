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
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const sharp = require('sharp');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const LEADS_DIR = path.join(DATA_DIR, 'leads');

const previewDir = () => process.env.MAIL_PREVIEW_DIR || '';
const brevoKey = () => (previewDir() ? '' : process.env.BREVO_API_KEY || '');
const mailConfigured = () => !!(previewDir() || brevoKey() || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS));

// ---------- images shown inside Brevo emails ----------
// Brevo's API cannot embed an image in the message the way SMTP can, so the (watermarked) preview is kept here
// and the email loads it from PUBLIC_URL/mail-img/<id>.jpg. The PNG is still attached as well.
const MAIL_IMG_DIR = path.join(DATA_DIR, 'mail-images');
const MAIL_IMG_RE = /^[0-9a-f]{32}$/;
const MAIL_IMG_KEEP_DAYS = 60;

async function saveMailImage(marked) {
  fs.mkdirSync(MAIL_IMG_DIR, { recursive: true });
  const cutoff = Date.now() - MAIL_IMG_KEEP_DAYS * 86400000;
  for (const f of fs.readdirSync(MAIL_IMG_DIR)) {
    const file = path.join(MAIL_IMG_DIR, f);
    try { if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file); } catch (_) {}
  }
  const id = crypto.randomBytes(16).toString('hex');
  const jpg = await sharp(marked).resize({ width: 1088, withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
  fs.writeFileSync(path.join(MAIL_IMG_DIR, `${id}.jpg`), jpg);
  return id;
}

function readMailImage(id) {
  if (!MAIL_IMG_RE.test(String(id || ''))) return null;
  try { return fs.readFileSync(path.join(MAIL_IMG_DIR, `${id}.jpg`)); } catch (_) { return null; }
}

// "Name <addr@x.com>" or "addr@x.com" -> { name, email }
function parseAddress(s) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(String(s || ''));
  if (m) return m[1] ? { name: m[1], email: m[2].trim() } : { email: m[2].trim() };
  return { email: String(s || '').trim() };
}

async function sendViaBrevo({ from, to, name, replyTo, subject, text, html, image }) {
  const body = {
    sender: parseAddress(from),
    to: [name ? { email: to, name } : { email: to }],
    subject,
    htmlContent: html,
    textContent: text,
    attachment: [{ name: 'coins-for-anything-design.png', content: image.toString('base64') }],
  };
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

/**
 * image: PNG buffer, ALREADY watermarked by the caller. This module never sees a clean render.
 * summary: [[label, value], ...] describing the design.
 */
async function sendDesignEmail({ to, name, image, summary, siteUrl }) {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'Coins for Anything <no-reply@localhost>';
  const hello = name ? `Hi ${esc(name.split(' ')[0])},` : 'Hi there,';
  const rows = summary.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="padding:6px 14px 6px 0;color:#777;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#222;font-size:14px">${esc(v)}</td></tr>`).join('');
  const button = siteUrl
    ? `<p style="margin:26px 0 8px"><a href="${esc(siteUrl)}" style="background:#F58220;color:#ffffff;text-decoration:none;font-weight:bold;letter-spacing:1px;padding:14px 26px;display:inline-block;font-size:15px">ORDER YOUR COINS &rsaquo;</a></p>`
    : '';

  // SMTP embeds the picture in the message; Brevo loads it from this site (and without PUBLIC_URL it is attachment only)
  let imgSrc = 'cid:coin-design';
  if (brevoKey()) imgSrc = siteUrl ? `${siteUrl.replace(/\/+$/, '')}/mail-img/${await saveMailImage(image)}.jpg` : '';
  const picture = imgSrc
    ? `<img src="${esc(imgSrc)}" alt="Your custom coin design" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:1px solid #DDD8D0">`
    : '<p style="margin:0;font-size:15px;line-height:1.6;color:#4A4A4A"><b>Your design is attached to this email.</b></p>';

  const html =`<!doctype html><html><body style="margin:0;background:#F5F1EA;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EA"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
  <tr><td style="background:#1A1A1A;border-bottom:4px solid #F58220;padding:18px 28px;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:2px">COINS FOR ANYTHING</td></tr>
  <tr><td style="padding:28px">
    <p style="margin:0 0 12px;font-size:16px;color:#222">${hello}</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4A4A4A">Here is the coin you designed. It looks great. This preview carries our watermark; when you order, our artists prepare clean, production-ready artwork and send you a proof to approve before anything is minted.</p>
    ${picture}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px">${rows}</table>
    ${button}
    <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#777">Questions, or want changes? Just reply to this email and a real person will help.</p>
  </td></tr>
  <tr><td style="background:#F4F4F4;padding:16px 28px;font-size:12px;line-height:1.6;color:#777">100% Veteran Owned &amp; Operated &middot; The Quality is Always Here<br>You are receiving this because you asked us to email you a coin design at coinsforanything.com.</td></tr>
</table></td></tr></table></body></html>`;

  const text = `${name ? `Hi ${name.split(' ')[0]},` : 'Hi there,'}\n\nHere is the coin you designed (attached). This preview carries our watermark; when you order, our artists prepare clean, production-ready artwork and send you a proof to approve before anything is minted.\n\n`
    + summary.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')
    + (siteUrl ? `\n\nOrder your coins: ${siteUrl}` : '') + '\n\nQuestions? Just reply to this email.\n\nCoins for Anything';

  const subject = 'Your custom coin design from Coins for Anything';
  if (brevoKey()) return sendViaBrevo({ from, to, name, replyTo: process.env.MAIL_REPLY_TO, subject, text, html, image });

  const info = await getTransport().sendMail({
    from,
    to,
    replyTo: process.env.MAIL_REPLY_TO || undefined,
    subject,
    text,
    html,
    attachments: [
      { filename: 'your-coin-design.png', content: image, contentType: 'image/png', cid: 'coin-design' },
      // a second, ordinary attachment: many mail apps hide inline images from the attachment list
      { filename: 'coins-for-anything-design.png', content: image, contentType: 'image/png' },
    ],
  });

  if (previewDir()) {
    fs.mkdirSync(previewDir(), { recursive: true });
    fs.writeFileSync(path.join(previewDir(), `design-${Date.now()}.eml`), info.message);
  }
  return info;
}

// One JSON file per lead, so nothing is lost if the webhook or the CRM is down
function saveLead(lead) {
  fs.mkdirSync(LEADS_DIR, { recursive: true });
  const record = { createdAt: new Date().toISOString(), ...lead };
  const stamp = record.createdAt.replace(/[-:.TZ]/g, '').slice(0, 14);
  fs.writeFileSync(path.join(LEADS_DIR, `${stamp}-${Math.random().toString(16).slice(2, 8)}.json`), JSON.stringify(record, null, 2));
  return record;
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

module.exports = { mailConfigured, sendDesignEmail, readMailImage, saveLead, notifyLead };
