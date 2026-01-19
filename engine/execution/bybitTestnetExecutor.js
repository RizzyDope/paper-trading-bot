const axios = require("axios");
const crypto = require("crypto");

function createBybitTestnetExecutor({
  account,
  riskEngine,
  performanceTracker,
  log,
}) {
  const BASE_URL = "https://api-testnet.bybit.com";

  function sign(params, secret) {
    const ordered = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");

    return crypto
      .createHmac("sha256", secret)
      .update(ordered)
      .digest("hex");
  }

  // 🔐 NEVER log secrets
  function sanitize(params) {
    const safe = { ...params };
    if (safe.api_key) safe.api_key = "***";
    if (safe.sign) safe.sign = "***";
    return safe;
  }

  async function privateRequest(path, params) {
    const timestamp = Date.now();

    const payload = {
      ...params,
      api_key: process.env.BYBIT_TESTNET_API_KEY,
      timestamp,
    };

    payload.sign = sign(payload, process.env.BYBIT_TESTNET_API_SECRET);

    try {
      const res = await axios.post(`${BASE_URL}${path}`, payload, {
        timeout: 10_000,
      });

      if (res.data?.retCode !== 0) {
        log("❌ BYBIT API ERROR");
        log(`Path: ${path}`);
        log(`Code: ${res.data.retCode}`);
        log(`Message: ${res.data.retMsg}`);
        log(`Params: ${JSON.stringify(sanitize(payload))}`);
        return null;
      }

      return res.data;
    } catch (err) {
      log("💥 BYBIT REQUEST FAILED");
      log(`Path: ${path}`);
      log(`Error: ${err.message}`);

      if (err.response) {
        log(`HTTP ${err.response.status}`);
        log(`Response: ${JSON.stringify(err.response.data)}`);
      }

      return null;
    }
  }

  // 🔎 STEP 1 — Query live open position (SAFE)
  async function fetchOpenPosition(symbol) {
    try {
      const res = await privateRequest("/v5/position/list", {
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

  // 🔄 STEP 2 — Resync local state with Bybit (CRITICAL)
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
    };

    log(`[EXEC] Position opened`);
  }

  async function closePosition(exitPrice, reason) {
    const pos = account.openPosition;
    if (!pos) return;

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

    let pnl =
      pos.side === "LONG"
        ? (exitPrice - pos.entryPrice) * pos.size
        : (pos.entryPrice - exitPrice) * pos.size;

    account.equity += pnl;

    if (pnl < 0) {
      riskEngine.registerLoss(Math.abs(pnl));
    }

    performanceTracker.recordTrade({
      side: pos.side,
      entry: pos.entryPrice,
      exit: exitPrice,
      pnl,
      result: pnl > 0 ? "WIN" : "LOSS",
      reason,
    });

    log(
      `[EXEC] CLOSED pnl=${pnl.toFixed(2)} equity=${account.equity.toFixed(2)}`
    );

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

    if (pos.side === "LONG" && bid <= pos.stopPrice) {
      closePosition(bid, "STOP_LOSS");
    }

    if (pos.side === "SHORT" && ask >= pos.stopPrice) {
      closePosition(ask, "STOP_LOSS");
    }

    if (pos.side === "LONG" && bid >= pos.takeProfitPrice) {
      closePosition(bid, "TAKE_PROFIT");
    }

    if (pos.side === "SHORT" && ask <= pos.takeProfitPrice) {
      closePosition(ask, "TAKE_PROFIT");
    }
  }

  return {
    onDecision,
    onPrice,
    hasOpenPosition,
    resyncPosition, // ✅ NEW
  };
}

module.exports = { createBybitTestnetExecutor };