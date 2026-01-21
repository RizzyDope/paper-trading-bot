/**
 * PerformanceTracker — Option A
 * Pure trade ledger with derived statistics
 */

function createPerformanceTracker({ startingEquity }) {
  if (!Number.isFinite(startingEquity)) {
    throw new Error("PerformanceTracker requires startingEquity");
  }

  const trades = [];

  function recordTrade(trade) {
    const {
      side,
      entry,
      exit,
      pnl,
      result,
      reason,
      durationMinutes,
      r,
    } = trade;

    trades.push({
      side,
      entry,
      exit,
      pnl,
      r,
      result,
      reason,
      durationMinutes,
      timestamp: Date.now(),
    });
  }

  function getSummary() {
    const totalTrades = trades.length;

    let wins = 0;
    let losses = 0;
    let netPnl = 0;
    let totalR = 0;

    for (const t of trades) {
      netPnl += t.pnl;
      totalR += Number.isFinite(t.r) ? t.r : 0;

      if (t.result === "WIN") wins++;
      if (t.result === "LOSS") losses++;
    }

    const avgR = totalTrades > 0 ? totalR / totalTrades : 0;
    const equity = startingEquity + netPnl;

    return {
      totalTrades,
      wins,
      losses,
      netPnl,
      avgR,
      equity,
    };
  }

  function getTrades() {
    return [...trades];
  }

  function reset() {
    trades.length = 0;
  }

  return {
    recordTrade,
    getSummary,
    getTrades,
    reset,
  };
}

module.exports = { createPerformanceTracker };