const { start, stop } = require("./core/lifecycle");
const { log } = require("./core/logger");
const env = require("./config/env");
const { startTelegramBot } = require("./telegram/commandHandler");
const { startPriceStream } = require("./market/priceStream");
const { createFeedHealth } = require("./market/feedHealth");
const { evaluateDailyBias } = require("./engine/strategy/biasEvaluator");
const { evaluateStructure } = require("./engine/strategy/structureEvaluator");
const { evaluateEntry } = require("./engine/strategy/entryEvaluator");
const { decide } = require("./engine/strategy/decisionEngine");
const { createRiskEngine } = require("./engine/risk/riskEngine");
const { calculateATR } = require("./engine/risk/atr");
const { createBybitTestnetExecutor } = require("./engine/execution/bybitTestnetExecutor");
const { createPerformanceTracker } = require("./stats/performanceTracker");
const { createCandleStore } = require("./storage/stateStore");
const { createCandleBuilder } = require("./market/candleBuilder");
const { createSymbolEngine } = require("./engine/symbolEngine");


start();

setInterval(() => {
  log("💓 system heartbeat");
}, 60_000);


function isTradeTimeAllowed() {
  const now = new Date();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  const blockStart = 20 * 60 + 30; // 20:30 UTC
  const blockEnd = 0 * 60 + 30; // 00:30 UTC

  if (minutes >= blockStart || minutes < blockEnd) {
    return false;
  }
  return true;
}

let lastRiskResetUTCDate = new Date().getUTCDate();

const riskEngine = createRiskEngine({
  startingEquity: env.startingEquity,
  riskPerTrade: env.riskPerTrade,
  maxDailyLoss: env.maxDailyLoss,
});

const account = {
  equity: env.startingEquity,
  openPosition: null,
};

const performanceTracker = createPerformanceTracker({ log });

const executor = createBybitTestnetExecutor({
  account,
  riskEngine,
  performanceTracker,
  log,
});

const feedHealth = createFeedHealth({ log });

startTelegramBot({
  token: process.env.TELEGRAM_BOT_TOKEN,
  account,
  executor,
  performanceTracker,
  feedHealth,
  getBias: () => "MULTI", // per-symbol now
  getStructure: () => "MULTI", // per-symbol now
  structureTF: "5m",
  biasTF: "4h",
  log,
});

function checkDailyRiskReset() {
  const currentUTCDate = new Date().getUTCDate();
  if (currentUTCDate !== lastRiskResetUTCDate) {
    log("🔄 New UTC day detected — resetting daily risk");
    riskEngine.resetDailyLoss();
    lastRiskResetUTCDate = currentUTCDate;
  }
}

const btcEngine = createSymbolEngine({
  symbol: "BTCUSDT",
  log,
  executor,
  riskEngine,
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

const trxEngine = createSymbolEngine({
  symbol: "TRXUSDT",
  log,
  executor,
  riskEngine,
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
  BTCUSDT: btcEngine,
  TRXUSDT: trxEngine,
};

startPriceStream(({ symbol, bid, ask, timestamp }) => {

  checkDailyRiskReset();

  const engine = engines[symbol];
  if (!engine) return;

  const midPrice = (bid + ask) /2;

  engine.onPrice(midPrice, timestamp);

  executor.onPrice({bid, ask});
}, feedHealth);

process.on("SIGINT", stop);
process.on("SIGTERM", stop);