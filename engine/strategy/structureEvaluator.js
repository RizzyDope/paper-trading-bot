function evaluateStructure(candles, atr) {
  if (!candles || candles.length < 4 || !atr) {
    return "RANGE";
  }

  const closed = candles.slice(0, -1);

  const c1 = closed[closed.length - 3];
  const c2 = closed[closed.length - 2];
  const c3 = closed[closed.length - 1];

  const MIN_BODY_ATR = 0.25;
  const MIN_RANGE_ATR = 0.45;

  function isStrong(c) {
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    return body >= atr * MIN_BODY_ATR && range >= atr * MIN_RANGE_ATR;
  }

  // ==========================
  // 🔴 BEARISH STRUCTURE
  // ==========================
  const bearish =
    // Lower highs + lower lows
    c2.high < c1.high &&
    c2.low < c1.low &&
    c3.high < c2.high &&
    c3.low < c2.low &&

    // At least 2 strong candles for momentum
    (
      (isStrong(c1) && isStrong(c2)) ||
      (isStrong(c2) && isStrong(c3))
    );

  if (bearish) return "BEARISH_STRUCTURE";

  // ==========================
  // 🟢 BULLISH STRUCTURE
  // ==========================
  const bullish =
    // Higher highs + higher lows
    c2.high > c1.high &&
    c2.low > c1.low &&
    c3.high > c2.high &&
    c3.low > c2.low &&

    // At least 2 strong candles for momentum
    (
      (isStrong(c1) && isStrong(c2)) ||
      (isStrong(c2) && isStrong(c3))
    );

  if (bullish) return "BULLISH_STRUCTURE";

  return "RANGE";
}

module.exports = { evaluateStructure };