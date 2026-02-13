const axios = require("axios");
const crypto = require("crypto");

function createBinanceTestnetExecutor({
  account,
  riskEngine,
  performanceTracker,
  log,
  executionTracker,
  notifyTradeOpen,
  notifyTradeClose,
  notifySystemAlert, // ✅ kept intact
}) {
  const BASE_URL = "https://testnet.binancefuture.com";

  // ✅ Symbol precision cache
  const symbolPrecisionCache = {};

  // =====================================================
  // SIGNING HELPERS
  // =====================================================

  function signQuery(query, secret) {
    return crypto
      .createHmac("sha256", secret)
      .update(query)
      .digest("hex");
  }

  // =====================================================
  // PRIVATE REQUEST (POST)
  // =====================================================

  async function privateRequest(path, params) {
    const timestamp = Date.now();

    const query = new URLSearchParams({
      ...params,
      timestamp,
    }).toString();

    const signature = signQuery(
      query,
      process.env.BINANCE_TESTNET_API_SECRET
    );

    try {
      const res = await axios.post(
        `${BASE_URL}${path}?${query}&signature=${signature}`,
        null,
        {
          headers: {
            "X-MBX-APIKEY": process.env.BINANCE_TESTNET_API_KEY,
          },
          timeout: 10_000,
        }
      );

      return res.data;
    } catch (err) {
      log("❌ BINANCE API ERROR");
      log(`Path: ${path}`);

      if (err.response && err.response.data) {
        const { code, msg } = err.response.data;

        log(JSON.stringify(err.response.data, null, 2));
        executionTracker?.recordExchangeReject(code, msg);

        notifySystemAlert?.(
          `Exchange rejected request\n` +
            `Path: ${path}\n` +
            `Symbol: ${params?.symbol || "UNKNOWN"}\n` +
            `Code: ${code}\n` +
            `Message: ${msg}`
        );
      } else {
        log(err.message);
      }

      return null;
    }
  }

  // =====================================================
  // PRIVATE GET (UNCHANGED)
  // =====================================================

  async function privateGet(path, params) {
    const timestamp = Date.now();

    const query = new URLSearchParams({
      ...params,
      timestamp,
    }).toString();

    const signature = signQuery(
      query,
      process.env.BINANCE_TESTNET_API_SECRET
    );

    try {
      const res = await axios.get(
        `${BASE_URL}${path}?${query}&signature=${signature}`,
        {
          headers: {
            "X-MBX-APIKEY": process.env.BINANCE_TESTNET_API_KEY,
          },
          timeout: 10_000,
        }
      );

      return res.data;
    } catch (err) {
      log("❌ BINANCE API ERROR");
      log(`Path: ${path}`);
      log(err?.response?.data || err.message);
      return null;
    }
  }

  // =====================================================
  // ✅ PRECISION FETCH (NEW — ONLY ADDITION)
  // =====================================================

  async function getSymbolStepSize(symbol) {
    if (symbolPrecisionCache[symbol]) {
      return symbolPrecisionCache[symbol];
    }

    const exchangeInfo = await privateGet("/fapi/v1/exchangeInfo", {});
    if (!exchangeInfo) return null;

    const symbolInfo = exchangeInfo.symbols.find(
      (s) => s.symbol === symbol
    );

    if (!symbolInfo) return null;

    const lotFilter = symbolInfo.filters.find(
      (f) => f.filterType === "LOT_SIZE"
    );

    if (!lotFilter) return null;

    const stepSize = parseFloat(lotFilter.stepSize);

    symbolPrecisionCache[symbol] = stepSize;

    return stepSize;
  }

  // =====================================================
  // ENSURE LEVERAGE (UNCHANGED)
  // =====================================================

  async function ensureLeverage(symbol, leverage = 10) {
    const res = await privateRequest("/fapi/v1/leverage", {
      symbol,
      leverage,
    });

    if (!res) {
      log(`⚠️ Could not confirm leverage for ${symbol}`);
      return;
    }

    log(`⚙️ Leverage ensured for ${symbol}: ${leverage}x`);
  }

  // =====================================================
  // POSITION RESYNC (UNCHANGED)
  // =====================================================

  async function fetchOpenPosition(symbol) {
    const res = await privateGet("/fapi/v2/positionRisk", { symbol });
    if (!res || !Array.isArray(res)) return null;

    const pos = res.find((p) => Number(p.positionAmt) !== 0);
    if (!pos) return null;

    return {
      symbol: pos.symbol,
      side: Number(pos.positionAmt) > 0 ? "LONG" : "SHORT",
      entryPrice: Number(pos.entryPrice),
      size: Math.abs(Number(pos.positionAmt)),
    };
  }

  async function resyncPosition(symbol) {
    log(`[RESYNC] Checking live position for ${symbol}`);
    const livePos = await fetchOpenPosition(symbol);

    if (!livePos) {
      if (account.openPosition) {
        log("[RESYNC] ⚠️ Local position cleared (no live position)");
        account.openPosition = null;
      }
      return;
    }

    log("[RESYNC] ✅ Live position detected — restoring state");

    account.openPosition = {
      ...livePos,
      stopPrice: null,
      takeProfitPrice: null,
    };
  }

  // =====================================================
  // CORE LOGIC
  // =====================================================

  function hasOpenPosition() {
    return account.openPosition !== null;
  }

  async function openPosition({ symbol, side, entryPrice, stopPrice }) {
    if (!riskEngine.canTakeTrade()) {
      log("[EXEC] ❌ Trade blocked — risk engine disallowed");
      executionTracker?.recordInternalReject("RISK_BLOCKED");
      return;
    }

    const rawSize = riskEngine.calculatePositionSize({
      entryPrice,
      stopPrice,
    });

    // ✅ NEW — Dynamic precision handling
    const stepSize = await getSymbolStepSize(symbol);
    if (!stepSize) {
      log(`[EXEC] ❌ Could not fetch precision for ${symbol}`);
      return;
    }

    const size = Math.floor(rawSize / stepSize) * stepSize;

    if (size <= 0) {
      log(
        `[EXEC] ❌ Size too small for ${symbol} (raw=${rawSize.toFixed(
          6
        )}) — skipped`
      );
      executionTracker?.recordInternalReject("SIZE_TOO_SMALL");
      return;
    }

    const decimals = Math.max(0, Math.round(-Math.log10(stepSize)));
    const formattedSize = size.toFixed(decimals);

    await ensureLeverage(symbol, 10);

    const orderSide = side === "LONG" ? "BUY" : "SELL";

    log(`[EXEC] Opening ${side} ${symbol} size=${formattedSize}`);

    const res = await privateRequest("/fapi/v1/order", {
      symbol,
      side: orderSide,
      type: "MARKET",
      quantity: formattedSize,
      positionSide: "BOTH",
    });

    if (!res) {
      log("⚠️ Order NOT placed — API error");
      return;
    }

    const riskPerUnit = Math.abs(entryPrice - stopPrice);
    const riskAmount = riskPerUnit * parseFloat(formattedSize);

    const takeProfitPrice =
      side === "LONG"
        ? entryPrice + riskPerUnit * 2
        : entryPrice - riskPerUnit * 2;

    account.openPosition = {
      symbol,
      side,
      entryPrice,
      stopPrice,
      takeProfitPrice,
      size: parseFloat(formattedSize),
      openedAt: Date.now(),
      riskAmount,
    };

    log("[EXEC] Position opened");

    notifyTradeOpen?.({
      symbol,
      side,
      entryPrice,
      stopPrice,
      takeProfitPrice,
      size: parseFloat(formattedSize),
    });
  }

  async function closePosition(exitPrice, reason) {
    const pos = account.openPosition;
    if (!pos) return;

    log(`[EXEC] Closing position (${reason})`);

    const side = pos.side === "LONG" ? "SELL" : "BUY";

    const res = await privateRequest("/fapi/v1/order", {
      symbol: pos.symbol,
      side,
      type: "MARKET",
      quantity: pos.size.toString(),
      reduceOnly: true,
      positionSide: "BOTH",
    });

    if (!res) {
      log("⚠️ Close order failed — position state unchanged");
      return;
    }

    const pnl =
      pos.side === "LONG"
        ? (exitPrice - pos.entryPrice) * pos.size
        : (pos.entryPrice - exitPrice) * pos.size;

    riskEngine.updateAfterTrade(pnl);
    account.equity = riskEngine.getEquity();

    const r = pos.riskAmount > 0 ? pnl / pos.riskAmount : 0;

    performanceTracker.recordTrade({
      side: pos.side,
      entry: pos.entryPrice,
      exit: exitPrice,
      pnl,
      r,
      result: pnl > 0 ? "WIN" : "LOSS",
      reason,
      durationMinutes: (Date.now() - pos.openedAt) / 60000,
    });

    log(
      `[EXEC] CLOSED pnl=${pnl.toFixed(2)} equity=${account.equity.toFixed(
        2
      )}`
    );

    notifyTradeClose?.({
      symbol: pos.symbol,
      side: pos.side,
      entry: pos.entryPrice,
      exit: exitPrice,
      pnl,
      r,
      reason,
      equity: account.equity,
    });

    account.openPosition = null;
  }

  function onDecision(decision, price, atr, symbol) {
    if (!atr) return;

    const stopDistance = atr * 1.5;

    if (decision === "ENTER_LONG" && !account.openPosition) {
      openPosition({
        symbol,
        side: "LONG",
        entryPrice: price,
        stopPrice: price - stopDistance,
      });
    }

    if (decision === "ENTER_SHORT" && !account.openPosition) {
      openPosition({
        symbol,
        side: "SHORT",
        entryPrice: price,
        stopPrice: price + stopDistance,
      });
    }
  }

  function onPrice({ bid, ask }) {
    const pos = account.openPosition;
    if (!pos) return;

    if (pos.side === "LONG" && bid <= pos.stopPrice)
      closePosition(bid, "STOP_LOSS");

    if (pos.side === "SHORT" && ask >= pos.stopPrice)
      closePosition(ask, "STOP_LOSS");

    if (pos.side === "LONG" && bid >= pos.takeProfitPrice)
      closePosition(bid, "TAKE_PROFIT");

    if (pos.side === "SHORT" && ask <= pos.takeProfitPrice)
      closePosition(ask, "TAKE_PROFIT");
  }

  return {
    onDecision,
    onPrice,
    hasOpenPosition,
    resyncPosition,
  };
}

module.exports = { createBinanceTestnetExecutor };