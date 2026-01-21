const { log } = require("../core/logger");

/**
 * Creates a candle builder for a given timeframe
 * timeframeMs example:
 * - 5m = 5 * 60 * 1000
 * - 15m = 15 * 60 * 1000
 * - 1D = 24 * 60 * 60 * 1000
 */
function createCandleBuilder(
  timeframeMs,
  onCandleClose,
  { onGapDetected } = {}
) {
  let currentCandle = null;
  let lastCandleTime = null;

  function getBucketTime(timestamp) {
    return Math.floor(timestamp / timeframeMs) * timeframeMs;
  }

  function onPrice(price, timestamp = Date.now()) {
    const bucketTime = getBucketTime(timestamp);

    // First tick ever
    if (!currentCandle) {
      currentCandle = {
        startTime: bucketTime,
        open: price,
        high: price,
        low: price,
        close: price,
      };
      lastCandleTime = bucketTime;
      return;
    }

    // New candle bucket
    if (bucketTime !== currentCandle.startTime) {
      // 🔍 GAP DETECTION
      const gapMs = bucketTime - lastCandleTime;
      const expectedMs = timeframeMs;

      if (gapMs > expectedMs * 1.5 && onGapDetected) {
        log(
          `[GAP] Missing candles detected: ${new Date(
            lastCandleTime
          ).toISOString()} → ${new Date(bucketTime).toISOString()}`
        );

        onGapDetected(lastCandleTime, bucketTime);
      }

      // Close previous candle
      onCandleClose(currentCandle);

      // Start new candle
      currentCandle = {
        startTime: bucketTime,
        open: price,
        high: price,
        low: price,
        close: price,
      };

      lastCandleTime = bucketTime;
      return;
    }

    // Update existing candle
    currentCandle.high = Math.max(currentCandle.high, price);
    currentCandle.low = Math.min(currentCandle.low, price);
    currentCandle.close = price;
  }

  return { onPrice };
}

module.exports = { createCandleBuilder };