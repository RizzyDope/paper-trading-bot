function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;

  let trs = [];

  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];

    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );

    trs.push(tr);
  }

  const atr =
    trs.reduce((sum, v) => sum + v, 0) / trs.length;

  return atr;
}

module.exports = { calculateATR };