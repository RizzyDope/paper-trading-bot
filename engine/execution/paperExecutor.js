/**
 * Paper execution engine
 * Simulates trade execution without real orders
 */

function createPaperExecutor({ account, riskEngine, performanceTracker, log }) {

  function hasOpenPosition() {
    return account.openPosition !== null;
  }

  function openPosition({ side, entryPrice, stopPrice }) {
    const size = riskEngine.calculatePositionSize({
      entryPrice,
      stopPrice,
      equity: account.equity,
    });

    if (size <= 0) {
      log(" Position size is zero — trade skipped");
      return;
    }

    // ✅ derive take-profit from risk (1:2 R:R)
    const riskPerUnit = Math.abs(entryPrice - stopPrice);
    const takeProfitPrice =
      side === "LONG"
        ? entryPrice + riskPerUnit * 2
        : entryPrice - riskPerUnit * 2;

    account.openPosition = {
      side,
      entryPrice,
      stopPrice,
      takeProfitPrice,
      size,
    };

    log(
      ` OPEN ${side} | entry=${entryPrice} stop=${stopPrice} tp=${takeProfitPrice} size=${size.toFixed(
        4
      )}`
    );
  }

  function closePosition(exitPrice, reason) {
  const pos = account.openPosition;
  if (!pos) return;

  let pnl = 0;

  if (pos.side === "LONG") {
    pnl = (exitPrice - pos.entryPrice) * pos.size;
  } else {
    pnl = (pos.entryPrice - exitPrice) * pos.size;
  }

  account.equity += pnl;

  if (pnl < 0) {
    riskEngine.registerLoss(Math.abs(pnl));
  }

  const riskPerUnit = Math.abs(pos.entryPrice - pos.stopPrice);
  const rMultiple = pnl / (riskPerUnit * pos.size);

  performanceTracker.recordTrade({
    side: pos.side,
    entry: pos.entryPrice,
    exit: exitPrice,
    pnl,
    rMultiple,
    result: pnl > 0 ? "WIN" : "LOSS",
    reason,
  });

  log(
    ` CLOSE ${pos.side} | exit=${exitPrice} pnl=${pnl.toFixed(
      2
    )} equity=${account.equity.toFixed(2)} reason=${reason}`
  );

  log("📊 Updated performance summary");
  log(performanceTracker.getSummary());

  account.openPosition = null;
}

  function onDecision(decision, price, atr) {
  if (!atr) return;

  const stopDistance = atr * 1.5;

  if (decision === "ENTER_LONG" && !account.openPosition) {
    openPosition({
      side: "LONG",
      entryPrice: price,
      stopPrice: price - stopDistance,
    });
  }

  if (decision === "ENTER_SHORT" && !account.openPosition) {
    openPosition({
      side: "SHORT",
      entryPrice: price,
      stopPrice: price + stopDistance,
    });
  }
}

  function onPrice({ bid, ask }) {
    const pos = account.openPosition;
    if (!pos) return;

    if (pos.side === "LONG") {
      if (bid <= pos.stopPrice) return closePosition(bid, "STOP_LOSS");
      if (bid >= pos.takeProfitPrice) return closePosition(bid, "TAKE_PROFIT");
    }

    if (pos.side === "SHORT") {
      if (ask >= pos.stopPrice) return closePosition(ask, "STOP_LOSS");
      if (ask <= pos.takeProfitPrice) return closePosition(ask, "TAKE_PROFIT");
    }
  }

  return {
    onDecision,
    onPrice,
    hasOpenPosition,
  };
}

module.exports = { createPaperExecutor };