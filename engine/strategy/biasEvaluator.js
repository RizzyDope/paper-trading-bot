/**
 * Evaluates higher-timeframe (4H) bias
 * Uses STRUCTURAL control, not candle color
 *
 * Rules encoded exactly from your description
 */
function evaluateDailyBias(candles, previousBias = "NEUTRAL") {
  // We need at least 3 candles:
  // - one forming (ignored)
  // - two closed for comparison
  if (!candles || candles.length < 3) {
    return previousBias;
  }

  // Ignore the currently forming candle
  const closed = candles.slice(0, -1);

  // Last two CLOSED candles
  const prev = closed[closed.length - 2];
  const last = closed[closed.length - 1];

  /* =========================
     🟢 BULLISH CONDITIONS
     ========================= */

  const bullishContinuation =
    last.high > prev.high &&
    last.close > prev.close;

  const bullishInvalidation =
    last.close < prev.open &&
    last.low < prev.low;

  /* =========================
     🔴 BEARISH CONDITIONS
     ========================= */

  const bearishContinuation =
    last.low < prev.low &&
    last.close < prev.close;

  const bearishInvalidation =
    last.close > prev.open &&
    last.high > prev.high;

  /* =========================
     🧠 STATE MACHINE
     ========================= */

  // If currently BULLISH
  if (previousBias === "BULLISH") {
    if (bullishContinuation) return "BULLISH";
    if (bullishInvalidation) return "BEARISH";
    return "NEUTRAL";
  }

  // If currently BEARISH
  if (previousBias === "BEARISH") {
    if (bearishContinuation) return "BEARISH";
    if (bearishInvalidation) return "BULLISH";
    return "NEUTRAL";
  }

  // If currently NEUTRAL
  if (bullishContinuation) return "BULLISH";
  if (bearishContinuation) return "BEARISH";

  return "NEUTRAL";
}

module.exports = { evaluateDailyBias };