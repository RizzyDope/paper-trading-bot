function createCandleStore(maxCandles = 100) {
  const candles = [];

  function addCandle(candle) {
    candles.push(candle);

    if (candles.length > maxCandles) {
      candles.shift(); // remove oldest candle
    }
  }

  // 🔄 NEW: used for backfilled candles
  function addHistorical(candle) {
    // Avoid duplicates (same candle start time)
    if (candles.some(c => c.startTime === candle.startTime)) {
      return;
    }

    candles.push(candle);

    // Ensure candles are always ordered by time
    candles.sort((a, b) => a.startTime - b.startTime);

    // Enforce max size
    while (candles.length > maxCandles) {
      candles.shift();
    }
  }

  function getCandles() {
    return [...candles]; // return a copy (safety)
  }

  function getLastCandle() {
    return candles[candles.length - 1] || null;
  }

  return {
    addCandle, // live candles
    addHistorical, // backfill candles
    getCandles,
    getLastCandle,
  };
}

module.exports = { createCandleStore };