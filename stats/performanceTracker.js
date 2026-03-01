function createPerformanceTracker() {
  const trades = [];
  let startingEquity = 0;

  function setStartingEquity(value) {
    startingEquity = value;
  }

  function recordTrade(trade) {
    const {
      side,
      entry,
      exit,
      pnl,
      risk,
      result,
      reason,
      durationMinutes,
    } = trade;

    const r = risk > 0 ? pnl / risk : 0;

    trades.push({
      side,
      entry,
      exit,
      pnl,
      risk,
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

    return {
      totalTrades,
      wins,
      losses,
      netPnl,
      avgR,
      equity: startingEquity + netPnl,
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
    setStartingEquity,
  };
}

module.exports = { createPerformanceTracker };