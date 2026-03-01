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
  notifySystemAlert,
}) {
  const BASE_URL = "https://testnet.binancefuture.com";

  let monitoring = false;
  let timeOffset = 0;

  async function syncServerTime() {
    try {
      const res = await axios.get(`${BASE_URL}/fapi/v1/time`);
      const serverTime = res.data.serverTime;
      timeOffset = serverTime - Date.now();
      log(`🕒 Time synced. Offset: ${timeOffset} ms`);
    } catch (err) {
      log("⚠️ Failed to sync server time.");
    }
  }

  // =============================
  // SIGN
  // =============================

  function signQuery(query, secret) {
    return crypto
      .createHmac("sha256", secret)
      .update(query)
      .digest("hex");
  }

  async function privateGet(path, params = {}) {
    const timestamp = Date.now() + timeOffset;
    const query = new URLSearchParams({
      ...params,
      timestamp,
      recvWindow: 5000,
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
        }
      );
      return res.data;
    } catch (err) {
      log("❌ BINANCE GET ERROR");

      if (err.response && err.response.data) {
        log(JSON.stringify(err.response.data, null, 2));
      } else if (err.request) {
        log("No response received from Binance.");
      } else {
        log(err.message);
      }

      return null;
    }
  }

  async function privatePost(path, params = {}) {
    const timestamp = Date.now() + timeOffset;
    const query = new URLSearchParams({
      ...params,
      timestamp,
      recvWindow: 5000,
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
        }
      );
      return res.data;
    } catch (err) {
      log("❌ BINANCE POST ERROR");
      if (err.response && err.response.data) {
        log(JSON.stringify(err.response.data, null, 2));
      } else {
        log(err.message);
      }
      executionTracker?.recordExchangeReject(
        err?.response?.data?.code,
        err?.response?.data?.msg
      );
      return null;
    }
  }

  async function ensureLeverage(symbol, leverage = 10) {
    const res = await privatePost("/fapi/v1/leverage", {
      symbol,
      leverage,
    });

    if (!res) {
      log(`⚠️ Could not set leverage for ${symbol}`);
      return false;
    }

    log(`⚙️ Leverage set to ${leverage}x for ${symbol}`);
    return true;
  }

  async function privateDelete(path, params = {}) {
    const timestamp = Date.now() + timeOffset;
    const query = new URLSearchParams({
      ...params,
      timestamp,
      recvWindow: 5000,
    }).toString();

    const signature = signQuery(
      query,
      process.env.BINANCE_TESTNET_API_SECRET
    );

    try {
      const res = await axios.delete(
        `${BASE_URL}${path}?${query}&signature=${signature}`,
        {
          headers: {
            "X-MBX-APIKEY": process.env.BINANCE_TESTNET_API_KEY,
          },
        }
      );
      return res.data;
    } catch (err) {
      log("❌ BINANCE DELETE ERROR");

      if (err.response && err.response.data) {
        log(JSON.stringify(err.response.data, null, 2));
      } else {
        log(err.message);
      }

      return null;
    }
  }

  // =============================
  // BINANCE AUTHORITY
  // =============================

  async function getBinanceUTCDate() {
    const res = await privateGet("/fapi/v1/time");
    if (!res) return null;
    return new Date(res.serverTime).getUTCDate();
  }

  async function getCrossWalletBalance() {
    const balances = await privateGet("/fapi/v2/balance");
    if (!balances) return null;

    const usdt = balances.find((b) => b.asset === "USDT");
    return usdt ? Number(usdt.crossWalletBalance) : null;
  }

  async function fetchOpenPosition(symbol) {
    const res = await privateGet("/fapi/v2/positionRisk", { symbol });
    if (!res) return null;

    const pos = res.find((p) => Number(p.positionAmt) !== 0);
    return pos || null;
  }

  async function getStepSize(symbol) {
    const info = await privateGet("/fapi/v1/exchangeInfo");
    if (!info) return null;

    const symbolInfo = info.symbols.find(s => s.symbol === symbol);
    if (!symbolInfo) return null;

    const lotFilter = symbolInfo.filters.find(
      f => f.filterType === "LOT_SIZE"
    );

    return lotFilter ? parseFloat(lotFilter.stepSize) : null;
  }

  async function getTickSize(symbol) {
    const info = await privateGet("/fapi/v1/exchangeInfo");
    if (!info) return null;

    const symbolInfo = info.symbols.find(s => s.symbol === symbol);
    if (!symbolInfo) return null;

    const priceFilter = symbolInfo.filters.find(
      f => f.filterType === "PRICE_FILTER"
    );

    return priceFilter ? parseFloat(priceFilter.tickSize) : null;
  }

  // =============================
  // CORE
  // =============================

  function hasOpenPosition() {
    return account.openPosition !== null;
  }

  async function openPosition({ symbol, side, entryPrice, stopPrice }) {
    if (account.openPosition) {
      log("⚠️ Position already open globally.");
      return;
    }

    await syncServerTime();

    // 1️⃣ Fetch balance
    const currentEquity = await getCrossWalletBalance();
    if (!currentEquity) {
      log("❌ Cannot fetch balance.");
      return;
    }

    // 2️⃣ Check Binan ce UTC
    const utcDate = await getBinanceUTCDate();
    if (riskEngine.getCurrentUTCDate() !== utcDate) {
      riskEngine.initializeNewDay(currentEquity, utcDate);
      performanceTracker.setStartingEquity(currentEquity);
      log("📅 New Binance UTC Day");
      log(`💰 Start Equity: ${currentEquity.toFixed(2)}`);
      log(
        `⚠️ Max Daily Risk: ${riskEngine
          .getMaxDailyLossAmount()
          .toFixed(2)}`
      );
    }

    // 3️⃣ Daily halt check
    if (!riskEngine.canTakeTrade(currentEquity)) {
      log("⛔ Daily loss limit reached.");
      return;
    }

    // 4️⃣ Size
    const rawSize = riskEngine.calculatePositionSize({
      entryPrice,
      stopPrice,
      currentEquity,
    });

    if (rawSize <= 0) {
      log("❌ Invalid size.");
      return;
    }

   const stepSize = await getStepSize(symbol);
    if (!stepSize) {
      log("❌ Could not fetch step size.");
      return;
    }

    const qtyDecimals = Math.max(
      0,
      Math.round(-Math.log10(stepSize))
    );

    const adjustedSize =
      Math.floor(rawSize / stepSize) * stepSize;

    if (adjustedSize <= 0) {
      log("❌ Size too small after precision adjustment.");
      return;
    }

    const decimals = Math.max(
      0,
      Math.round(-Math.log10(stepSize))
    );

    // 🔒 Margin Protection
    const leverage = 5;
    const maxMarginUsage = currentEquity * 0.4; // 50% cap

    const maxNotional = maxMarginUsage * leverage;
    const maxSizeByMargin = maxNotional / entryPrice;

    const finalSize = Math.min(adjustedSize, maxSizeByMargin);

    if (finalSize <= 0) {
      log("❌ Size invalid after margin cap.");
      return;
    }

    const quantity = finalSize.toFixed(decimals);

    const orderSide = side === "LONG" ? "BUY" : "SELL";

    // 5️⃣ Record entry balance
    const entryEquity = currentEquity;

    // 🔥 ENSURE LEVERAGE BEFORE ENTRY
    const leverageOk = await ensureLeverage(symbol, leverage);
    if (!leverageOk) {
      log("❌ Cannot set leverage. Entry aborted.");
      return;
    }

    // 6️⃣ Place market
    const marketOrder = await privatePost("/fapi/v1/order", {
      symbol,
      side: orderSide,
      type: "MARKET",
      quantity,
    });

    if (!marketOrder) {
      log("❌ Entry failed.");
      return;
    }

    log("✅ MARKET ENTRY PLACED");

    // Wait a bit for fill
    await new Promise((r) => setTimeout(r, 1500));

    const pos = await fetchOpenPosition(symbol);

    if (!pos) {
      log("❌ Position not found after entry.");
      return;
    }

    log("📊 POSITION OPENED");
    log(`Symbol: ${symbol}`);
    log(`Side: ${side}`);
    log(`Size: ${pos.positionAmt}`);
    log(`Entry Price: ${pos.entryPrice}`);
    log(`Notional: ${pos.notional}`);
    log(`Leverage: ${pos.leverage}`);
    log(`Liquidation: ${pos.liquidationPrice}`);

    const actualEntry = Number(pos.entryPrice);
    const riskDistance = Math.abs(entryPrice - stopPrice);

    const stop =
      side === "LONG"
        ? actualEntry - riskDistance
        : actualEntry + riskDistance;

    const takeProfit =
      side === "LONG"
        ? actualEntry + riskDistance * 3
        : actualEntry - riskDistance * 3;

    const exitSide = side === "LONG" ? "SELL" : "BUY";

    const tickSize = await getTickSize(symbol);
    if (!tickSize) {
      log("❌ Could not fetch tick size.");
      return;
    }

    // Determine decimal precision
    const pricePrecision =
      tickSize.toString().split(".")[1]?.length || 0;

    // Round to tick size
    const rawRoundedStop =
      Math.floor(stop / tickSize) * tickSize;

    const rawRoundedTP =
      Math.floor(takeProfit / tickSize) * tickSize;

    // Remove floating noise
    const stopFormatted = Number(
      rawRoundedStop.toFixed(pricePrecision)
    );

    const tpFormatted = Number(
      rawRoundedTP.toFixed(pricePrecision)
    );

    log(`🛑 Stop Price (rounded): ${stopFormatted}`);
    log(`🎯 Take Profit Price (rounded): ${tpFormatted}`);

    // 7️⃣ Place SL
    const positionAmt = Math.abs(Number(pos.positionAmt));
    const riskAmount = Math.abs(actualEntry - stopFormatted) * positionAmt;

    const formattedQty = Number(positionAmt).toFixed(qtyDecimals);

    const slOrder = await privatePost("/fapi/v1/algoOrder", {
      algoType: "CONDITIONAL",
      symbol,
      side: exitSide,
      type: "STOP_MARKET",
      triggerPrice: String(stopFormatted),
      quantity: String(formattedQty),
      reduceOnly: "true",
      workingType: "MARK_PRICE",
    });

    if (!slOrder || slOrder.code) {
      log("❌ SL failed — closing immediately.");

      await cleanupProtectiveOrders(symbol);

      await privatePost("/fapi/v1/order", {
        symbol,
        side: exitSide,
        type: "MARKET",
        quantity: formattedQty,
        reduceOnly: "true",
      });

      return;
    }

    log(`🛑 SL PLACED @ ${stopFormatted}`);

    // 8️⃣ Place TP
    const tpOrder = await privatePost("/fapi/v1/algoOrder", {
      algoType: "CONDITIONAL",
      symbol,
      side: exitSide,
      type: "TAKE_PROFIT_MARKET",
      triggerPrice: String(tpFormatted),
      quantity: String(formattedQty),
      reduceOnly: "true",
      workingType: "MARK_PRICE",
    });

    if (!tpOrder) {
      log("❌ TP failed — cancelling SL and closing immediately.");

      // cancel SL
      await cleanupProtectiveOrders(symbol);

      // close position
      await privatePost("/fapi/v1/order", {
        symbol,
        side: exitSide,
        type: "MARKET",
        quantity: formattedQty,
        reduceOnly: "true",
      });

      return;
    }

    log(`🎯 TP PLACED @ ${tpFormatted}`);

    account.openPosition = {
      symbol,
      side,
      entryPrice: actualEntry,
      entryEquity,
      stop,
      takeProfit,
      risk: riskAmount,
    };

    notifyTradeOpen?.({
      symbol,
      side,
      entry: actualEntry,
      stop,
      takeProfit,
    });

    startPositionMonitor(symbol);
  }

  async function cleanupProtectiveOrders(symbol) {
    try {
      const result = await privateDelete("/fapi/v1/algoOpenOrders", { symbol });
      
      if (result && result.code === 200) {
        log(`🧹 All open algo orders for ${symbol} cancelled.`);
      } else {
        log(`🧹 Cleanup info: ${result.msg || "No orders to cancel"}`);
      }
    } catch (err) {
      log("⚠ Cleanup algo error:", err.message);
    }
  }

  async function startPositionMonitor(symbol) {
    if (monitoring) return;
    monitoring = true;

    log("🔍 Monitor started");

    while (account.openPosition) {
      await new Promise((r) => setTimeout(r, 3000));

      const pos = await fetchOpenPosition(symbol);

      if (!pos) {
        log("📉 Position confirmed closed by exchange.");

        await cleanupProtectiveOrders(symbol);

        const entryEquity = account.openPosition.entryEquity;
        const finalEquity = await getCrossWalletBalance();

        // Fetch last trades to detect exit details
        const trades = await privateGet("/fapi/v1/userTrades", {
          symbol,
          limit: 10,
        });

        let exitPrice = null;
        let realized = 0;

        if (trades && trades.length) {
          const last = trades.reverse().find(t => t.realizedPnl !== "0");
          if (last) {
            exitPrice = Number(last.price);
            realized = Number(last.realizedPnl);
          }
        }

        let reason = "UNKNOWN";

        if (exitPrice) {
          if (Math.abs(exitPrice - account.openPosition.stop) < 0.0001)
            reason = "STOP_LOSS";

          if (Math.abs(exitPrice - account.openPosition.takeProfit) < 0.0001)
            reason = "TAKE_PROFIT";
        }

        const pnl = realized;
        const result = pnl > 0 ? "WIN" : "LOSS";

        performanceTracker.recordTrade({
          side: account.openPosition.side,
          entry: account.openPosition.entryPrice, 
          exit: exitPrice,
          pnl,
          risk: account.openPosition.risk,
          result,
          reason,
        });

        log("📉 POSITION CLOSED");
        log(`Reason: ${reason}`);
        log(`Exit Price: ${exitPrice}`);
        log(`Realized PnL: ${pnl.toFixed(2)}`);
        log(`Equity Before: ${entryEquity.toFixed(2)}`);
        log(`Equity After: ${finalEquity.toFixed(2)}`);

        notifyTradeClose?.({
          symbol,
          pnl,
          equity: finalEquity,
        });

        account.openPosition = null;
        monitoring = false;
        log("🟢 Monitor stopped");
        return;
      }
    }

    monitoring = false;
  }

  function onDecision(decision, price, atr, symbol) {
  if (!atr) return;

  const stopDistance = atr * 1.5;

  if (decision === "ENTER_LONG") {
    openPosition({
      symbol,
      side: "LONG",
      entryPrice: price,
      stopPrice: price - stopDistance,
    });
  }

  if (decision === "ENTER_SHORT") {
    openPosition({
      symbol,
      side: "SHORT",
      entryPrice: price,
      stopPrice: price + stopDistance,
    });
  }
}

  return {
    onDecision,
    openPosition,
    hasOpenPosition,
  };
}

module.exports = { createBinanceTestnetExecutor };