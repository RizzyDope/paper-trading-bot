const axios = require("axios");
const { log } = require("../core/logger");

const BASE_URL = "https://api-testnet.bybit.com";

/**
 * Fetch missing candles from Bybit REST
 * Returns candles normalized to internal engine format
 */
async function fetchMissingCandles({
  symbol,
  interval, // e.g. "1", "5", "240"
  fromTs,
  toTs,
}) {
  try {
    const res = await axios.get(`${BASE_URL}/v5/market/kline`, {
      params: {
        category: "linear",
        symbol,
        interval,
        start: fromTs,
        end: toTs,
        limit: 200,
      },
    });

    if (res.data.retCode !== 0) {
      log(`[BACKFILL] Bybit error: ${res.data.retMsg}`);
      return [];
    }

    const list = res.data.result.list || [];

    // Normalize into engine candle format
    return list.map(c => ({
      startTime: Number(c[0]),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
    }));
  } catch (err) {
    log(`[BACKFILL] REST failure: ${err.message}`);
    return [];
  }
}

module.exports = { fetchMissingCandles };