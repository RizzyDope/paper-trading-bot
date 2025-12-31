function createPerformanceTracker({ log }) {
  const trades = [];

  function recordTrade(trade) {
    trades.push(trade);

    log(
      `📊 Trade recorded | ${trade.side} ${trade.result} pnl=${trade.pnl.toFixed(
        2
      )} R=${trade.rMultiple.toFixed(2)}`
    );
  }

  function getSummary() {
    const total = trades.length;
    if (total === 0) return null;

    const wins = trades.filter(t => t.result === "WIN").length;
    const losses = total - wins;

    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
    const avgR =
      trades.reduce((sum, t) => sum + t.rMultiple, 0) / total;

    return {
      totalTrades: total,
      wins,
      losses,
      winRate: (wins / total) * 100,
      totalPnL,
      avgR,
    };
  }

  return {
    recordTrade,
    getSummary,
  };
}

module.exports = { createPerformanceTracker };