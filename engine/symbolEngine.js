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

  // 🔹 NEW (injected, optional)
  fetchMissingCandles, // justification: clean separation of concerns

  // 🔹 NEW (injected, shared control)
  tradeControl, // justification: external entry permission (Telegram-controlled)
}) {
  let currentDailyBias = "NEUTRAL";
  let currentStructure5m = "RANGE";
  let lastEntrySignal = null;

  // 🔹 NEW: backfill guard
  // justification: prevent trading on incomplete history
  let isBackfilling = false;

  const store1m = createCandleStore(200);
  const store5m = createCandleStore(200);
  const store2h = createCandleStore(200);

  // -----------------------------
  // 1m CANDLE (ENTRIES)
  // -----------------------------
  const candle1m = createCandleBuilder(
    60_000,
    async (candle) => {
      store1m.addCandle(candle);
      log(`[${symbol}] 1m candle stored (${store1m.getCandles().length})`);

      // 🔐 HARD PAUSE: backfill
      if (isBackfilling) {
        log(`[${symbol}] ⏸ Trading paused — backfill in progress`);
        return;
      }

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

      // 🔑 TELEGRAM ENTRY GATE (NEW)
      if (
        (decision === "ENTER_LONG" || decision === "ENTER_SHORT") &&
        tradeControl &&
        tradeControl.enabled === false
      ) {
        log(`[${symbol}] ⏸ Entry blocked — trading paused via Telegram`);
        decision = "HOLD";
      }

      log(`[${symbol}] decision: ${decision}`);

      executor.onDecision(decision, candle.close, atr);
    },

    // -----------------------------
    // GAP CALLBACK (UNCHANGED)
    // -----------------------------
    async function onGapDetected(fromTs, toTs) {
      if (!fetchMissingCandles) return;

      log(`[${symbol}] 🧩 Gap detected — initiating backfill`);
      isBackfilling = true;

      try {
        const candles = await fetchMissingCandles({
          symbol,
          interval: "1",
          fromTs,
          toTs,
        });

        for (const c of candles) {
          store1m.addHistorical(c);
        }

        log(`[${symbol}] ✅ Backfill restored ${candles.length} candles`);
      } catch (err) {
        log(`[${symbol}] ❌ Backfill failed: ${err.message}`);
      } finally {
        isBackfilling = false;
        log(`[${symbol}] ▶ Trading resumed after backfill`);
      }
    }
  );

  // -----------------------------
  // 5m STRUCTURE
  // -----------------------------
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

  // -----------------------------
  // 2h DAILY BIAS
  // -----------------------------
  const candle2h = createCandleBuilder(2 * 60 * 60_000, (candle) => {
    store2h.addCandle(candle);
    log(`[${symbol}] 2h candle stored (${store2h.getCandles().length})`);

    const candles = store2h.getCandles();
    const newBias = evaluateDailyBias(candles);

    if (newBias !== currentDailyBias) {
      log(
        `[${symbol}] (2H) bias changed: ${currentDailyBias} → ${newBias}`
      );
      currentDailyBias = newBias;
    }
  });

  // -----------------------------
  // PRICE FAN-OUT (UNCHANGED)
  // -----------------------------
  function onPrice(price, timestamp) {
    candle1m.onPrice(price, timestamp);
    candle5m.onPrice(price, timestamp);
    candle2h.onPrice(price, timestamp);
  }

  return {
    symbol,
    onPrice,
  };
}

module.exports = { createSymbolEngine };