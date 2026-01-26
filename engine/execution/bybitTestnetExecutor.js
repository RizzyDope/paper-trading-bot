const axios = require("axios");
const crypto = require("crypto");

function createBybitTestnetExecutor({
  account,
  riskEngine,
  performanceTracker,
  log,

  executionTracker,
  notifyTradeOpen,
  notifyTradeClose,
}) {
  const BASE_URL = "https://api-testnet.bybit.com";

  // =====================================================
  // SIGNING HELPERS
  // =====================================================

  function signPost(body, timestamp, recvWindow, secret) {
  const payload =
    timestamp +
    process.env.BYBIT_TESTNET_API_KEY +
    recvWindow +
    JSON.stringify(body);

  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}


  function sanitize(params) {
    const safe = { ...params };
    if (safe.api_key) safe.api_key = "***";
    if (safe.sign) safe.sign = "***";
    return safe;
  }

  async function privateRequest(path, body) {
    const timestamp = Date.now().toString();
    const recvWindow = "5000";

    const signature = signPost(
      body,
      timestamp,
      recvWindow,
      process.env.BYBIT_TESTNET_API_SECRET
    );

    try {
      const res = await axios.post(`${BASE_URL}${path}`, body, {
        headers: {
          "X-BAPI-API-KEY": process.env.BYBIT_TESTNET_API_KEY,
          "X-BAPI-SIGN": signature,
          "X-BAPI-TIMESTAMP": timestamp,
          "X-BAPI-RECV-WINDOW": recvWindow,
          "Content-Type": "application/json",
        },
        timeout: 10_000,
      });

      if (res.data?.retCode !== 0) {
        log("❌ BYBIT API ERROR");
        log(`Path: ${path}`);
        log(`Code: ${res.data.retCode}`);
        log(`Message: ${res.data.retMsg}`);
        executionTracker?.recordExchangeReject(
          res.data.retCode,
          res.data.retMsg
        );
        return null;
      }

      return res.data;
    } catch (err) {
      log("💥 BYBIT REQUEST FAILED");
      log(`Path: ${path}`);
      log(err.message);
      return null;
    }
  }
  // =====================================================
  // GET REQUESTS (REQUIRED FOR RESYNC) — NEW & JUSTIFIED
  // =====================================================
  function signGet(queryString, timestamp, recvWindow) {
    const payload =
      timestamp +
      process.env.BYBIT_TESTNET_API_KEY +
      recvWindow +
      queryString;

    return crypto
      .createHmac("sha256", process.env.BYBIT_TESTNET_API_SECRET)
      .update(payload)
      .digest("hex");
  }

  async function privateGet(path, query) {
    const timestamp = Date.now().toString();

    const queryString = Object.keys(query)
      .sort()
      .map((k) => `${k}=${query[k]}`)
      .join("&");

    const recvWindow = "5000";
    const signature = signGet(queryString, timestamp, recvWindow);

    try {
      const res = await axios.get(`${BASE_URL}${path}?${queryString}`, {
        headers: {
          "X-BAPI-API-KEY": process.env.BYBIT_TESTNET_API_KEY,
          "X-BAPI-SIGN": signature,
          "X-BAPI-TIMESTAMP": timestamp,
          "X-BAPI-RECV-WINDOW": "5000",
        },
        timeout: 10_000,
      });

      if (res.data?.retCode !== 0) {
        log("❌ BYBIT API ERROR");
        log(`Path: ${path}`);
        log(`Code: ${res.data.retCode}`);
        log(`Message: ${res.data.retMsg}`);
        return null;
      }

      return res.data;
    } catch (err) {
      log("💥 BYBIT REQUEST FAILED");
      log(`Path: ${path}`);
      log(`Error: ${err.message}`);
      return null;
    }
  }

  async function forceOpenTestPosition() {
    log("🧪 FORCE TEST: opening manual LONG on SOLUSDT");

    const body = {
      category: "linear",
      symbol: "BTCUSDT",
      side: "Buy",
      orderType: "Market",
      qty: "0.001", // small, safe test size
      timeInForce: "IOC",
    };

    const res = await privateRequest("/v5/order/create", body);

    if (!res) {
      log("❌ FORCE TEST FAILED");
      return;
    }

    log("✅ FORCE TEST SUCCESS — ORDER ACCEPTED");
    log(JSON.stringify(res.result, null, 2));
  }

  // =====================================================
  // 🔎 RESYNC — FIXED (GET, NOT POST)
  // =====================================================
  async function fetchOpenPosition(symbol) {
    try {
      const res = await privateGet("/v5/position/list", {
        category: "linear",
        symbol,
      });

      if (!res) return null;

      const list = res.result?.list || [];
      const pos = list.find((p) => Number(p.size) > 0);

      if (!pos) return null;

      return {
        symbol: pos.symbol,
        side: pos.side === "Buy" ? "LONG" : "SHORT",
        entryPrice: Number(pos.avgPrice),
        size: Number(pos.size),
      };
    } catch (err) {
      log("[RESYNC] ❌ Position fetch error:", err.message);
      return null;
    }
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
  // CORE TRADING LOGIC — UNCHANGED
  // =====================================================
  function hasOpenPosition() {
    return account.openPosition !== null;
  }

  async function openPosition({ symbol, side, entryPrice, stopPrice }) {
    const size = riskEngine.calculatePositionSize({
      entryPrice,
      stopPrice,
      equity: account.equity,
    });

    if (size <= 0) {
      log("❌ Position size zero — skipped");
      return;
    }

    const orderSide = side === "LONG" ? "Buy" : "Sell";

    log(`[EXEC] Opening ${side} ${symbol} size=${size.toFixed(4)}`);

    const res = await privateRequest("/v5/order/create", {
      category: "linear",
      symbol,
      side: orderSide,
      orderType: "Market",
      qty: size.toFixed(4),
      timeInForce: "IOC",
    });

    if (!res) {
      log("⚠️ Order NOT placed — API error");
      return;
    }

    const riskPerUnit = Math.abs(entryPrice - stopPrice);
    const riskAmount = riskPerUnit * size;

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
      size,
      openedAt: Date.now(),
      riskAmount,
    };

    log(`[EXEC] Position opened`);

    // 🔔 TELEGRAM OPEN NOTIFICATION (SAFE)
    if (notifyTradeOpen) {
      notifyTradeOpen({
        symbol,
        side,
        entryPrice,
        stopPrice,
        takeProfitPrice,
        size,
      });
    }
  }

  async function closePosition(exitPrice, reason) {
    const pos = account.openPosition;
    if (!pos) return;

    const durationMinutes = (Date.now() - pos.openedAt) / 60000;

    const side = pos.side === "LONG" ? "Sell" : "Buy";

    log(`[EXEC] Closing position (${reason})`);

    const res = await privateRequest("/v5/order/create", {
      category: "linear",
      symbol: pos.symbol,
      side,
      orderType: "Market",
      qty: pos.size.toFixed(4),
      reduceOnly: true,
      timeInForce: "IOC",
    });

    if (!res) {
      log("⚠️ Close order failed — position state unchanged");
      return;
    }

    const pnl =
      pos.side === "LONG"
        ? (exitPrice - pos.entryPrice) * pos.size
        : (pos.entryPrice - exitPrice) * pos.size;

    const r = pos.riskAmount > 0 ? pnl / pos.riskAmount : 0;

    account.equity += pnl;

    if (pnl < 0) {
      riskEngine.registerLoss(Math.abs(pnl));
    }

    performanceTracker.recordTrade({
      side: pos.side,
      entry: pos.entryPrice,
      exit: exitPrice,
      pnl,
      r,
      result: pnl > 0 ? "WIN" : "LOSS",
      reason,
      durationMinutes,
    });

    log(`[EXEC] CLOSED pnl=${pnl.toFixed(2)} equity=${account.equity.toFixed(2)}`);

    // 🔔 TELEGRAM CLOSE NOTIFICATION (SAFE)
    if (notifyTradeClose) {
      notifyTradeClose({
        symbol: pos.symbol,
        side: pos.side,
        entry: pos.entryPrice,
        exit: exitPrice,
        pnl,
        r,
        reason,
        durationMinutes,
        equity: account.equity,
      });
    }

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

    if (pos.side === "LONG" && bid <= pos.stopPrice) closePosition(bid, "STOP_LOSS");
    if (pos.side === "SHORT" && ask >= pos.stopPrice) closePosition(ask, "STOP_LOSS");
    if (pos.side === "LONG" && bid >= pos.takeProfitPrice) closePosition(bid, "TAKE_PROFIT");
    if (pos.side === "SHORT" && ask <= pos.takeProfitPrice) closePosition(ask, "TAKE_PROFIT");
  }

  return {
    onDecision,
    onPrice,
    hasOpenPosition,
    resyncPosition, // unchanged placeholder

    forceOpenTestPosition,
  };
}

module.exports = { createBybitTestnetExecutor };