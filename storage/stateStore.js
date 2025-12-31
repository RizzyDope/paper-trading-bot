function createCandleStore(maxCandles = 100) {
  const candles = [];

  function addCandle(candle) {
    candles.push(candle);

    if (candles.length > maxCandles) {
      candles.shift(); // remove oldest candle
    }
  }

  function getCandles() {
    return [...candles]; // return a copy (safety)
  }

  function getLastCandle() {
    return candles[candles.length - 1] || null;
  }

  return {
    addCandle,
    getCandles,
    getLastCandle,
  };
}

module.exports = { createCandleStore };