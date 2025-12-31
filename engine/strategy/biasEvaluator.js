/**
 * Evaluates higher-timeframe (1D) bias
 * @param {Array} candles - array of CLOSED daily candles (oldest → newest)
 * @returns {"BULLISH" | "BEARISH" | "NEUTRAL"}
 */
function evaluateDailyBias(candles) {
  // We need at least 2 candles to compare structure
  if (candles.length < 3) {
    return "NEUTRAL";
  }

  const last = candles[candles.length - 2];
  const previous = candles[candles.length - 3];

  // Bullish break
  if (last.close > previous.high) {
    return "BULLISH";
  }

  // Bearish break
  if (last.close < previous.low) {
    return "BEARISH";
  }

  // No decisive break
  return "NEUTRAL";
}

module.exports = { evaluateDailyBias };