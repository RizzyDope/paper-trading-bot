function evaluateEntry(candles, bias, structure, atr) {
  if (!candles || candles.length < 3 || !atr) {
    return null;
  }

  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 1];

  // 1m tuning
  const PULLBACK_ATR = 0.2;
  const RECLAIM_ATR = 0.12;

  // -----------------------
  // BULLISH ENTRY
  // -----------------------
  if (bias === "BULLISH" && structure === "BULLISH_STRUCTURE") {
    const pullbackDepth =
      Math.max(
        c1.close - c2.low,
        c1.close - c2.close
      );

    const pullback =
      (c2.low < c1.low || c2.close < c1.close) &&
      pullbackDepth >= atr * PULLBACK_ATR;

    const reclaimStrength =
      c3.close - c2.high;

    const reclaim =
      c3.close > c2.high &&
      reclaimStrength >= atr * RECLAIM_ATR;

    if (pullback && reclaim) {
      return "LONG_ENTRY";
    }
  }

  // -----------------------
  // BEARISH ENTRY
  // -----------------------
  if (bias === "BEARISH" && structure === "BEARISH_STRUCTURE") {
    const pullbackDepth =
      Math.max(
        c2.high - c1.close,
        c2.close - c1.close
      );

    const pullback =
      (c2.high > c1.high || c2.close > c1.close) &&
      pullbackDepth >= atr * PULLBACK_ATR;

    const breakdownStrength =
      c2.low - c3.close;

    const breakdown =
      c3.close < c2.low &&
      breakdownStrength >= atr * RECLAIM_ATR;

    if (pullback && breakdown) {
      return "SHORT_ENTRY";
    }
  }

  return null;
}

module.exports = { evaluateEntry };