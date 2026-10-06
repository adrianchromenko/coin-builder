'use strict';

// The order form takes "city, state and zip" as one line and the country in the customer's own words. The CRM and
// the payment processor want them apart.

// "Austin, TX 78701" -> city, state, zip. Anything that does not read that way goes in whole as the city.
function splitCityStateZip(s) {
  const m = /^\s*(.+?)\s*,\s*([A-Za-z .]+?)\s+([A-Za-z0-9 -]{3,10})\s*$/.exec(s || '');
  return m ? { City: m[1], State: m[2].trim(), Zip_Code: m[3] } : { City: (s || '').trim() };
}

// "United States", "USA", "Canada" -> the two-letter code; anything else, null
const CODES = { us: 'US', usa: 'US', unitedstates: 'US', unitedstatesofamerica: 'US', america: 'US', canada: 'CA', ca: 'CA' };
function countryCode(s) {
  return CODES[String(s || '').toLowerCase().replace(/[^a-z]/g, '')] || null;
}

module.exports = { splitCityStateZip, countryCode };
