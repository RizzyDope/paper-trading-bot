const { start, stop } = require("./core/lifecycle");
const { log } = require("./core/logger");
const env = require("./config/env");
const { startTelegramBot } = require("./telegram/commandHandler");
const { startPriceStream } = require("./market/priceStream");
// const { fetchMissingCandles } = require("./market/candleBackfill");
const { createFeedHealth } = require("./market/feedHealth");
const { evaluateDailyBias } = require("./engine/strategy/biasEvaluator");
const { evaluateStructure } = require("./engine/strategy/structureEvaluator");
const { evaluateEntry } = require("./engine/strategy/entryEvaluator");
const { decide } = require("./engine/strategy/decisionEngine");
const { createRiskEngine } = require("./engine/risk/riskEngine");
const { calculateATR } = require("./engine/risk/atr");
const { createBinanceTestnetExecutor } = require("./engine/execution/binanceTestnetExecutor");
const { createExecutionTracker } = require("./engine/execution/executionTracker");
const { createPerformanceTracker } = require("./stats/performanceTracker");
const { createCandleStore } = require("./storage/stateStore");
const { createCandleBuilder } = require("./market/candleBuilder");
const { createSymbolEngine } = require("./engine/symbolEngine");

start();

setInterval(() => {
  log("💓 system heartbeat");
}, 60_000);

// ===============================================
// ⏰ Trading Time Filter (UNCHANGED)
// ===============================================

function isTradeTimeAllowed() {
  const now = new Date();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  const blockStart = 20 * 60 + 30;
  const blockEnd = 0 * 60 + 30;

  if (minutes >= blockStart || minutes < blockEnd) {
    return false;
  }
  return true;
}

// ===============================================
// 🔐 RISK ENGINE (NO LOCAL EQUITY)
// ===============================================

const riskEngine = createRiskEngine({
  riskPerTrade: env.riskPerTrade,
  maxDailyLossPercent: env.maxDailyLossPercent,
});

// ===============================================
// 🧾 ACCOUNT (NO LOCAL EQUITY)
// ===============================================

const account = {
  openPosition: null, // exchange authority
};

// ===============================================
// 📊 TRACKERS
// ===============================================

const performanceTracker = createPerformanceTracker();
const executionTracker = createExecutionTracker();

// ===============================================
// 🚀 EXECUTOR (BINANCE AUTHORITY)
// ===============================================

const executor = createBinanceTestnetExecutor({
  account,
  riskEngine,
  performanceTracker,
  executionTracker,
  log,
  notifyTradeOpen: startTelegramBot.notifyTradeOpen,
  notifyTradeClose: startTelegramBot.notifyTradeClose,
  notifySystemAlert: startTelegramBot.notifySystemAlert,
});


// ===============================================
// 📡 FEED HEALTH
// ===============================================

const feedHealth = createFeedHealth({ log });

// ===============================================
// 🧠 SYMBOL ENGINES
// ===============================================

const xrpEngine = createSymbolEngine({
  symbol: "XRPUSDT",
  log,
  executor,
  riskEngine,
  executionTracker,
  feedHealth,
  isTradeTimeAllowed,

  evaluateEntry,
  evaluateStructure,
  evaluateDailyBias,
  calculateATR,
  decide,

  createCandleStore,
  createCandleBuilder,
});

const solEngine = createSymbolEngine({
  symbol: "SOLUSDT",
  log,
  executor,
  riskEngine,
  executionTracker,
  feedHealth,
  isTradeTimeAllowed,

  evaluateEntry,
  evaluateStructure,
  evaluateDailyBias,
  calculateATR,
  decide,

  createCandleStore,
  createCandleBuilder,
});

const engines = {
  XRPUSDT: xrpEngine,
  SOLUSDT: solEngine,
};

// ===============================================
// 🤖 TELEGRAM
// ===============================================

startTelegramBot({
  token: process.env.TELEGRAM_BOT_TOKEN,
  account,
  executor,
  performanceTracker,
  feedHealth,
  engines,
  structureTF: "5m",
  biasTF: "4h",
  log,
});

// ===============================
// 🧪 MANUAL TEST TRADE (REMOVE AFTER)
// ===============================

// setTimeout(() => {
//   console.log("🚀 MANUAL TEST TRADE");

//   executor.openPosition({
//     symbol: "XRPUSDT", // or SOLUSDT
//     side: "LONG", // or SHORT
//     entryPrice: 1.40, // approximate current price
//     stopPrice: 1.39, // small distance
//   });

// }, 5000);

function scheduleDailySummary() {
  const now = new Date();

  const next = new Date();
  next.setUTCHours(0, 5, 0, 0); // 00:05 UTC (1:05am Nigeria)

  if (now > next) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  const delay = next - now;

  setTimeout(() => {
    const summary = executionTracker.getSummary();

    if (startTelegramBot.notifyDailyExecutionSummary) {
      startTelegramBot.notifyDailyExecutionSummary(summary);
    }

    executionTracker.reset();

    scheduleDailySummary(); // reschedule
  }, delay);
}

scheduleDailySummary();

// ===============================================
// 📈 PRICE STREAM (STRATEGY ONLY)
// ===============================================

startPriceStream(({ symbol, bid, ask, timestamp }) => {
  const engine = engines[symbol];
  if (!engine) return;

  const midPrice = (bid + ask) / 2;

  engine.onPrice(midPrice, timestamp);

  // ❌ REMOVED executor.onPrice()
  // Stops and TP now exchange-native
}, feedHealth);

// ===============================================

process.on("SIGINT", stop);
process.on("SIGTERM", stop);