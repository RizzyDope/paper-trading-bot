function evaluateStructure(candles) {
  // Need at least 4 candles so we can ignore the forming one
  if (!candles || candles.length < 4) {
    return "RANGE";
  }

  // Exclude the currently forming candle
  const closed = candles.slice(0, -1);

  // Use the last 3 CLOSED candles
  const c1 = closed[closed.length - 3];
  const c2 = closed[closed.length - 2];
  const c3 = closed[closed.length - 1];

  const bearish =
  c3.close < c2.close &&
  c2.close < c1.close &&

  c3.low < c2.low &&
  c2.low < c1.low &&

  c3.high < c2.high &&
  c2.high < c1.high;

if (bearish) {
  return "BEARISH_STRUCTURE";
}

const bullish =
  c3.close > c2.close &&
  c2.close > c1.close &&

  c3.high > c2.high &&
  c2.high > c1.high &&

  c3.low > c2.low &&
  c2.low > c1.low;

if (bullish) {
  return "BULLISH_STRUCTURE";
}

  return "RANGE";
}

module.exports = { evaluateStructure };
