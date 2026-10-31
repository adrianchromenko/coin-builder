'use strict';

/**
 * Quotes a coin order from the Coins for Anything price chart (lib/price-chart.json, made from the "Expanded Pricing
 * Chart" spreadsheet by scripts/import-pricing.py).
 *
 * How the chart prices a coin:
 *   - Each size (1" to 4" by quarter inch) has a mold fee and, per finish group, a per-coin price by quantity tier.
 *   - Up to 50 coins there is one price with any enamel color included. From 51 coins the price depends on whether
 *     the coins get color on no side, one side or both sides.
 *   - Add-ons (edges, numbering, keychains, epoxy...) cost so much per coin, some with a one-time setup fee.
 *   - Packaging (boxes, cases, stands) is per coin, cheaper from 75 coins, and adds a little shipping per piece.
 *   - Rush (under 10 business days): a flat fee under 100 coins, 20% of the coin cost from 100.
 *   - Shipping: a guide by size and quantity; small coins ship free from 300 coins.
 *   - Sales tax: only on orders shipped within Virginia (the company's state), on everything but the shipping.
 * The chart stops at 1,200 coins and at 4": past that (and for "other" sizes) the team quotes by hand.
 *
 * PRICING=0 in .env turns the quote off; orders are then saved as plain quote requests with no price shown.
 */

const chart = require('./price-chart.json');
const { splitCityStateZip, countryCode } = require('./address');

// Virginia sales tax, in percent: SALES_TAX_VA in .env, 5.3 (the statewide rate) unless set. Virginia's rate differs
// by locality (5.3 to 7 percent), so the team confirms the exact tax with the proof.
function salesTaxRate() {
  const n = Number(process.env.SALES_TAX_VA);
  return Number.isFinite(n) && n >= 0 ? n : 5.3;
}

// The state an order is taxed in, from the shipping address as the customer typed it: 'VA' for a US address in
// Virginia, '' otherwise (the company only collects sales tax in Virginia)
function taxStateOf({ cityStateZip = '', country = '' } = {}) {
  const code = countryCode(country);
  if (code && code !== 'US') return '';
  const state = (splitCityStateZip(cityStateZip).State || '').trim();
  return /^(va|virginia)$/i.test(state) ? 'VA' : '';
}

// The sizes on the quote form, in inches (the diameter of a round coin, the longest side of an odd-shaped one).
// Besides these the form offers "Other", with the size written in words; see /api/orders in server.js.
const SIZES = chart.sizes;
const MAX_QUANTITY = chart.largeTiers[chart.largeTiers.length - 1][1];

const COLORS = [
  { key: 'none', label: 'No color (plain metal)' },
  { key: 'one', label: 'Color on one side' },
  { key: 'two', label: 'Color on both sides' },
];

// finish on the quote form (a key from lib/prompt.js FINISHES, or a group key) -> the chart's finish group
const groupOf = (finish) => chart.finishGroups.find((g) => g.key === finish || g.finishes.includes(finish)) || null;
const DEFAULT_GROUP = groupOf('shiny-gold').key;

function hasPricing() {
  return process.env.PRICING !== '0';
}

const round2 = (n) => Math.round(n * 100) / 100;
const asNum = (s) => Number(String(s).replace(/[^\d.]/g, ''));

// Which column of the tier list a quantity falls in; -1 when past the chart
function tierIndex(tiers, quantity) {
  return tiers.findIndex(([lo, hi]) => quantity >= lo && quantity <= hi);
}

/**
 * The per-coin price for a size, finish group and color choice at a quantity, or null when the chart has none.
 * colorApplies: false when the quantity is small enough that any color is included.
 */
function unitPrice(size, group, color, quantity) {
  const block = chart.prices[size];
  const prices = block && block.finishes[group];
  if (!prices) return null;
  const small = tierIndex(chart.smallTiers, quantity);
  if (small >= 0) return { unit: prices.small[small], colorApplies: false };
  const large = tierIndex(chart.largeTiers, quantity);
  if (large < 0) return null;
  const row = prices[color] || prices.none;
  return { unit: row[large], colorApplies: true };
}

function shippingFor(size, quantity) {
  const s = asNum(size);
  const row = chart.shipping.find((r) => s >= asNum(r.sizes[0]) && s <= asNum(r.sizes[1]));
  if (!row) return null;
  const col = row.upTo.findIndex((max) => quantity <= max);
  if (col >= 0) return row.flat[col];
  return round2(row.overPerCoin * quantity);
}

/**
 * Prices an order. Returns { priced: true, ...the quote } or { priced: false, reason } when the chart cannot price it
 * (a size written in words, more coins than the chart goes to). Unknown finish, color, add-on and packaging keys are
 * ignored rather than refused, so a stale page never blocks an order.
 */
function quote({ size, quantity, finish, color, addons = [], packaging = '', rush = false, taxState = '' } = {}) {
  if (!hasPricing()) return { priced: false, reason: 'pricing_off' };
  quantity = parseInt(quantity, 10);
  if (!quantity || quantity < 1) return { priced: false, reason: 'quantity' };
  if (!SIZES.includes(String(size))) return { priced: false, reason: 'size' };
  if (quantity > MAX_QUANTITY) return { priced: false, reason: 'quantity_over', max: MAX_QUANTITY };
  size = String(size);
  const group = groupOf(finish) || groupOf(DEFAULT_GROUP);
  color = COLORS.some((c) => c.key === color) ? color : 'two';
  const base = unitPrice(size, group.key, color, quantity);
  if (!base) return { priced: false, reason: 'chart' };

  const lines = [];
  const coins = round2(base.unit * quantity);
  const colorLabel = COLORS.find((c) => c.key === color).label;
  lines.push({
    key: 'coins', label: `${quantity.toLocaleString('en-US')} × ${size}" coins`, amount: coins,
    detail: `${group.label}, ${base.colorApplies ? colorLabel.toLowerCase() : 'any color included'} · $${base.unit.toFixed(2)} each`,
  });

  const mold = chart.prices[size].mold;
  lines.push({ key: 'mold', label: 'Mold and set-up', amount: mold, detail: `One-time, for a ${size}" die` });

  const chosenAddons = [];
  for (const key of [].concat(addons)) {
    const a = chart.addons.find((x) => x.key === key);
    if (!a || chosenAddons.includes(a)) continue;
    chosenAddons.push(a);
    const amount = round2(a.perCoin * quantity + (a.setup || 0));
    lines.push({
      key: `addon:${a.key}`, label: a.label, amount,
      detail: `$${a.perCoin.toFixed(2)} per coin${a.setup ? ` + $${a.setup.toFixed(2)} setup` : ''}`,
    });
  }

  let packagingShipping = 0;
  const pack = chart.packaging.find((p) => p.key === packaging) || null;
  if (pack) {
    const each = quantity < 75 ? pack.under75 : pack.from75;
    packagingShipping = round2(pack.shippingEach * quantity);
    lines.push({ key: `packaging:${pack.key}`, label: pack.label, amount: round2(each * quantity), detail: `$${each.toFixed(2)} each` });
  }

  let rushFee = 0;
  if (rush) {
    const flat = chart.rush.flat.find(([lo, hi]) => quantity >= lo && quantity <= hi);
    rushFee = flat ? flat[2] : round2(coins * chart.rush.percent / 100);
    lines.push({
      key: 'rush', label: `Rush production (${chart.rush.label.replace(/^<\s*/, 'under ')})`, amount: rushFee,
      detail: flat ? 'Flat fee' : `${chart.rush.percent}% of the coin cost`,
    });
  }

  const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const ground = shippingFor(size, quantity);
  const shipping = ground == null ? null : round2(ground + packagingShipping);
  if (shipping != null) {
    lines.push({
      key: 'shipping', label: 'Shipping (estimated)', amount: shipping,
      detail: shipping === 0 ? 'Free ground shipping at this quantity' : `Ground, in the US${packagingShipping ? `, incl. $${packagingShipping.toFixed(2)} for the packaging` : ''}`,
    });
  }
  // Sales tax, on Virginia orders only: on the coins, mold and extras, never on the shipping
  let tax = 0;
  if (taxState === 'VA' && salesTaxRate() > 0) {
    tax = round2(subtotal * salesTaxRate() / 100);
    lines.push({ key: 'tax', label: `Virginia sales tax (${salesTaxRate()}%)`, amount: tax, detail: 'On the coins, mold and extras; shipping is not taxed' });
  }
  const total = round2(subtotal + (shipping || 0) + tax);

  // Up to 50 coins, the chart's price at 100 is shown alongside to make the case for a bigger order
  let upsell = null;
  if (quantity <= 50) {
    const at100 = unitPrice(size, group.key, color, 100);
    if (at100 && at100.unit < base.unit) upsell = { quantity: 100, unit: at100.unit, saving: round2(base.unit - at100.unit) };
  }

  const notes = [];
  if (!base.colorApplies) notes.push('Up to 50 coins, enamel color is included at no extra cost.');
  if (rush) notes.push(chart.rush.note);
  notes.push(`${tax ? '' : 'No sales tax outside Virginia. '}Our team confirms the final quote with your proof.`);

  return {
    priced: true,
    currency: 'USD',
    chart: chart.source,
    size, quantity,
    finish: group.key, finishLabel: group.label,
    color, colorLabel, colorIncluded: !base.colorApplies,
    addons: chosenAddons.map((a) => a.key),
    packaging: pack ? pack.key : '',
    rush: !!rush,
    unit: base.unit, coins, mold, subtotal, shipping, tax, taxState: tax ? taxState : '', total,
    upsell,
    lines, notes,
  };
}

// What the quote form needs to offer the choices (sent with /api/config)
function catalog() {
  return {
    sizes: SIZES,
    maxQuantity: MAX_QUANTITY,
    molds: Object.fromEntries(SIZES.map((s) => [s, chart.prices[s].mold])),
    finishes: chart.finishGroups.map((g) => ({ key: g.key, label: g.label, finishes: g.finishes })),
    colors: COLORS,
    colorFrom: chart.largeTiers[0][0],
    addons: chart.addons,
    packaging: chart.packaging,
    rush: { label: chart.rush.label, note: chart.rush.note },
  };
}

module.exports = { SIZES, MAX_QUANTITY, COLORS, hasPricing, quote, catalog, groupOf, taxStateOf, salesTaxRate };
