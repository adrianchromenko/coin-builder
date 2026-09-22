'use strict';

// The public address of this deployment, without a trailing slash. PUBLIC_URL wins (set it in production so
// share previews, the sitemap, Stripe return links and the design emails all point at the real domain);
// otherwise the address the request came in on is used, which is right for local testing and previews.
function siteUrl(req) {
  const fixed = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (fixed) return fixed;
  if (!req) return '';
  return `${req.protocol}://${req.get('host')}`;
}

module.exports = { siteUrl };
