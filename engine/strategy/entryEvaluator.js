
/**
 * Evaluates 5m entry conditions
 * @param {Array} candles - array of CLOSED 5m candles (oldest → newest)
 * @param {"BULLISH" | "BEARISH" | "NEUTRAL"} bias
 * @param {"BULLISH_STRUCTURE" | "BEARISH_STRUCTURE" | "RANGE"} structure
 * @returns {"LONG_ENTRY" | "SHORT_ENTRY" | null}
 */
function evaluateEntry(candles, bias, structure) {
  // Need at least 3 candles to evaluate pullback + reclaim
  if (!candles || candles.length < 3) {
    return null;
  }

  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 1];

  // -----------------------
  // BULLISH ENTRY
  // -----------------------
  if (bias === "BULLISH" && structure === "BULLISH_STRUCTURE") {
    const pullback =
      c2.low < c1.low || c2.close < c1.close;

    const reclaim =
      c3.close > c2.high;

    if (pullback && reclaim) {
      return "LONG_ENTRY";
    }
  }

  // -----------------------
  // BEARISH ENTRY
  // -----------------------
  if (bias === "BEARISH" && structure === "BEARISH_STRUCTURE") {
    const pullback =
      c2.high > c1.high || c2.close > c1.close;

    const breakdown =
      c3.close < c2.low;

    if (pullback && breakdown) {
      return "SHORT_ENTRY";
    }
  }

  return null;
}

module.exports = { evaluateEntry };





