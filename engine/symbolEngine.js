function createSymbolEngine({
  symbol,
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
}) {
  
  let currentDailyBias = "NEUTRAL";
  let currentStructure5m = "RANGE";
  let lastEntrySignal = null;

  const store1m = createCandleStore(200);
  const store5m = createCandleStore(200);
  const store4h = createCandleStore(200);

  const candle1m = createCandleBuilder(60_000, (candle) => {
    store1m.addCandle(candle);
    log(`[${symbol}] 1m candle stored (${store1m.getCandles().length})`);

    const feedStatus = feedHealth.getStatus();

    if (feedStatus === "DANGER") {
      log(`[${symbol}] Trading frozen — feed danger`);
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
        log(`[${symbol}] Entry blocked — feed unstable`);
      }
      return;
    }

    if (entrySignal && entrySignal !== lastEntrySignal) {
      log(`[${symbol}] Entry signal: ${entrySignal}`);
      lastEntrySignal = entrySignal;
    }

    const decisionRaw = decide({
      bias: currentDailyBias,
      structure: currentStructure5m,
      entry: entrySignal,
      hasOpenPosition: executor.hasOpenPosition(),
      riskAllowed: riskEngine.canTakeTrade(),
    });

    let decision = decisionRaw;

    if (
      (decision === "ENTER_LONG" || decision === "ENTER_SHORT") &&
      !isTradeTimeAllowed()
    ) {
      log(`[${symbol}] Entry blocked — outside trading hours`);
      decision = "HOLD";
    }

    log(`[${symbol}] decision: ${decision}`);

    executor.onDecision(decision, candle.close, atr);
  });

  const candle5m = createCandleBuilder(5 * 60_000, (candle) => {
    store5m.addCandle(candle);
    log(`[${symbol}] 5m candle stored (${store5m.getCandles().length})`);

    const candles = store5m.getCandles();
    const atr5m = calculateATR(candles);
    const newStructure = evaluateStructure(candles, atr5m);

    if (newStructure !== currentStructure5m) {
      log(
        `[${symbol}] (5m) structure changed: ${currentStructure5m} → ${newStructure}`
      );
      currentStructure5m = newStructure;
    }
  });

  const candle4h = createCandleBuilder(4 * 60 * 60_000, (candle) => {
    store4h.addCandle(candle);
    log(`[${symbol}] 4h candle stored (${store4h.getCandles().length})`);

    const candles = store4h.getCandles();
    const newBias = evaluateDailyBias(candles);

    if (newBias !== currentDailyBias) {
      log(
        `[${symbol}] (4H) bias changed: ${currentDailyBias} → ${newBias}`
      );
      currentDailyBias = newBias;
    }
  });

  function onPrice(price, timestamp) {
    candle1m.onPrice(price, timestamp);
    candle5m.onPrice(price, timestamp);
    candle4h.onPrice(price, timestamp);
  }

  return {
    symbol,
    onPrice,
  };
}

module.exports = { createSymbolEngine };