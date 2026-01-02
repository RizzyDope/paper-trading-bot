function evaluateStructure(candles, atr) {
  // Need at least 4 candles so we can ignore the forming one
  if (!candles || candles.length < 4 || !atr) {
    return "RANGE";
  }

  // Exclude currently forming candle
  const closed = candles.slice(0, -1);

  // Last 3 CLOSED candles
  const c1 = closed[closed.length - 3];
  const c2 = closed[closed.length - 2];
  const c3 = closed[closed.length - 1];

  // === ATR thresholds (5m tuned) ===
  const MIN_BODY_ATR = 0.25; // candle body must be >= 25% ATR
  const MIN_RANGE_ATR = 0.6; // full candle range must be >= 60% ATR

  function isStrongCandle(c) {
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    return body >= atr * MIN_BODY_ATR && range >= atr * MIN_RANGE_ATR;
  }

  // ================================
  // 🔴 BEARISH STRUCTURE
  // ================================
  const bearish =
    // 1️⃣ All candles bearish
    c1.close < c1.open &&
    c2.close < c2.open &&
    c3.close < c3.open &&

    // 2️⃣ Progressive lower dominance (OCHL)
    c2.open < c1.open &&
    c2.close < c1.close &&
    c2.high < c1.high &&
    c2.low < c1.low &&

    c3.open < c2.open &&
    c3.close < c2.close &&
    c3.high < c2.high &&
    c3.low < c2.low &&

    // 3️⃣ Momentum filter
    isStrongCandle(c1) &&
    isStrongCandle(c2) &&
    isStrongCandle(c3);

  if (bearish) {
    return "BEARISH_STRUCTURE";
  }

  // ================================
  // 🟢 BULLISH STRUCTURE
  // ================================
  const bullish =
    // 1️⃣ All candles bullish
    c1.close > c1.open &&
    c2.close > c2.open &&
    c3.close > c3.open &&

    // 2️⃣ Progressive higher dominance (OCHL)
    c2.open > c1.open &&
    c2.close > c1.close &&
    c2.high > c1.high &&
    c2.low > c1.low &&

    c3.open > c2.open &&
    c3.close > c2.close &&
    c3.high > c2.high &&
    c3.low > c2.low &&

    // 3️⃣ Momentum filter
    isStrongCandle(c1) &&
    isStrongCandle(c2) &&
    isStrongCandle(c3);

  if (bullish) {
    return "BULLISH_STRUCTURE";
  }

  return "RANGE";
}

module.exports = { evaluateStructure };