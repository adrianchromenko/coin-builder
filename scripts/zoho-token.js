#!/usr/bin/env node
'use strict';

/**
 * Turns a Zoho Self Client grant code into the refresh token the server needs. Run it within ten minutes of
 * generating the code at https://api-console.zoho.com (Self Client > Generate Code, scopes
 * ZohoCRM.modules.leads.CREATE,ZohoCRM.modules.attachments.CREATE):
 *
 *   node scripts/zoho-token.js <grant code>                                 (client id and secret from .env)
 *   node scripts/zoho-token.js <client id> <client secret> <grant code> [accounts url]
 *
 * accounts url defaults to https://accounts.zoho.com (US). Use https://accounts.zoho.eu, .in, .com.au or .jp for
 * organizations on those data centers. Prints the lines to paste into .env.
 */

require('dotenv').config();
const args = process.argv.slice(2);
const [clientId, clientSecret, code, accounts = process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com'] = args.length === 1
  ? [process.env.ZOHO_CLIENT_ID, process.env.ZOHO_CLIENT_SECRET, args[0]]
  : args;
if (!clientId || !clientSecret || !code) {
  console.error('usage: node scripts/zoho-token.js <grant code>   (with ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in .env)');
  console.error('   or: node scripts/zoho-token.js <client id> <client secret> <grant code> [accounts url]');
  process.exit(1);
}

(async () => {
  const params = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code });
  const res = await fetch(`${accounts.replace(/\/$/, '')}/oauth/v2/token`, { method: 'POST', body: params });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token) {
    console.error('Zoho did not hand back a refresh token:', data.error || res.status, data);
    console.error(data.error === 'invalid_code' ? 'The grant code is used up or older than ten minutes: generate a new one and run this again.' : '');
    process.exit(1);
  }
  console.log('Add these to .env:\n');
  console.log(`ZOHO_CLIENT_ID=${clientId}`);
  console.log(`ZOHO_CLIENT_SECRET=${clientSecret}`);
  console.log(`ZOHO_REFRESH_TOKEN=${data.refresh_token}`);
  if (accounts !== 'https://accounts.zoho.com') console.log(`ZOHO_ACCOUNTS_URL=${accounts}`);
  console.log(`\n(api domain: ${data.api_domain || 'https://www.zohoapis.com'})`);
})();
