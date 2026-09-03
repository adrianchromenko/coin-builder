'use strict';

/**
 * Optional pricing. Set PRICE_TABLE in .env as JSON mapping coin size to
 * [minQuantity, unitPriceUSD] tiers, e.g.
 *   PRICE_TABLE={"1.5":[[1,9.5],[50,5.95],[100,4.95],[250,3.95]],"1.75":[[1,10.5],[50,6.45]]}
 * When it is not set, no prices are shown and orders are saved as quote requests.
 */

const SIZES = ['1.5', '1.75', '2', '2.5', '3'];

let table = null;
try {
  if (process.env.PRICE_TABLE) table = JSON.parse(process.env.PRICE_TABLE);
} catch (e) {
  console.warn('[coin-builder] PRICE_TABLE is not valid JSON; pricing disabled');
}

function hasPricing() {
  return !!table;
}

function unitPrice(size, quantity) {
  if (!table || !table[size]) return null;
  const tiers = table[size]
    .map(([min, price]) => [Number(min), Number(price)])
    .filter(([min, price]) => min > 0 && price > 0)
    .sort((a, b) => a[0] - b[0]);
  let chosen = null;
  for (const [min, price] of tiers) {
    if (quantity >= min) chosen = price;
  }
  return chosen;
}

function estimate(size, quantity) {
  const unit = unitPrice(size, quantity);
  if (unit == null) return null;
  return { size, quantity, unit, total: Math.round(unit * quantity * 100) / 100, currency: 'USD' };
}

module.exports = { SIZES, hasPricing, estimate };
