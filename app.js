const { start, stop } = require("./core/lifecycle");
const { log } = require("./core/logger");
const env = require("./config/env");
const { startTelegramBot } = require("./telegram/commandHandler");
const { startPriceStream } = require("./market/priceStream");
const { createFeedHealth } = require("./market/feedHealth");
const { createCandleBuilder } = require("./market/candleBuilder");
const { createCandleStore } = require("./storage/stateStore");
const { evaluateDailyBias } = require("./engine/strategy/biasEvaluator");
const { evaluateStructure } = require("./engine/strategy/structureEvaluator");
const { evaluateEntry } = require("./engine/strategy/entryEvaluator");
const { decide } = require("./engine/strategy/decisionEngine");
const { createRiskEngine } = require("./engine/risk/riskEngine");
const { calculateATR } = require("./engine/risk/atr");
const { createPaperExecutor } = require("./engine/execution/paperExecutor");
const { createPerformanceTracker } = require("./stats/performanceTracker");


start();

setInterval(() => {
  log("💓 system heartbeat");
}, 60_000);

let currentDailyBias = "NEUTRAL";
let currentStructure5m = "RANGE";
let lastEntrySignal = null;
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

const paperExecutor = createPaperExecutor({
  account,
  riskEngine,
  performanceTracker,
  log,
});

const feedHealth = createFeedHealth({ log });

startTelegramBot({
  token: process.env.TELEGRAM_BOT_TOKEN,
  account,
  paperExecutor,
  performanceTracker,
  feedHealth,
  getBias: () => currentDailyBias,
  getStructure: () => currentStructure5m,
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

const store1m = createCandleStore(200);
const store5m = createCandleStore(200);
const store4h = createCandleStore(200);

// Create candle builders
const candle1m = createCandleBuilder(60 * 1000, (candle) => {
  store1m.addCandle(candle);
  log(` 1m candle stored (${store1m.getCandles().length})`);

  const feedStatus = feedHealth.getStatus();

  if (feedStatus === "DANGER") {
    log(" Trading frozen — feed in danger state");
    return;
  }

  const candles = store1m.getCandles();
  const atr = calculateATR(candles);

  if (!atr) return;

  const entrySignal = evaluateEntry(
    candles,
    currentDailyBias,
    currentStructure5m,
    atr
  );

  if (feedStatus === "HALT_ENTRIES") {
    if (entrySignal) {
      log("⚠️ Entry blocked — feed unstable");
    }
    return;
  }

  if (entrySignal && entrySignal !== lastEntrySignal) {
    log(` Entry signal (1m): ${entrySignal}`);
    lastEntrySignal = entrySignal;
  }

  const riskAllowed = riskEngine.canTakeTrade();

  // 🧠 Decision engine — uses SAME signal name
  const decision = decide({
    bias: currentDailyBias,
    structure: currentStructure5m,
    entry: entrySignal,
    hasOpenPosition: paperExecutor.hasOpenPosition(),
    riskAllowed,
  });

  log(` decision: ${decision}`);
  paperExecutor.onDecision(decision, candle.close, atr);
});

const candle5m = createCandleBuilder(5 * 60 * 1000, (candle) => {
  checkDailyRiskReset()
  store5m.addCandle(candle);
  log(` 5m candle stored (${store5m.getCandles().length})`);

  // Evaluate structure
  const candles = store5m.getCandles();
  const atr5m = calculateATR(store5m.getCandles());
  const newStructure = evaluateStructure(candles, atr5m);

  // Log only if structure changes
  if (newStructure !== currentStructure5m) {
    log(` (5m) structure changed: ${currentStructure5m} → ${newStructure}`);
    currentStructure5m = newStructure;
  }
});

const candle4h = createCandleBuilder(4 * 60 * 60 * 1000, (candle) => {
  store4h.addCandle(candle);
  log(` 4h candle stored (${store4h.getCandles().length})`);

  // Evaluate bias using stored candles
  const candles = store4h.getCandles();
  const newBias = evaluateDailyBias(candles);

  // Log bias ONLY if it changed
  if (newBias !== currentDailyBias) {
    log(` (4H) bias changed: ${currentDailyBias} → ${newBias}`);
    currentDailyBias = newBias;
  }
});

// Wire price stream into candle builders
startPriceStream((price) => {
  const now = Date.now();

  candle1m.onPrice(price, now);
  candle5m.onPrice(price, now);
  candle4h.onPrice(price, now);

  paperExecutor.onPrice(price);
}, feedHealth);

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
