/**
 * Professional Risk Engine
 * Capital authority + daily + drawdown protection
 */

function createRiskEngine({
  startingEquity,
  riskPerTrade,
  maxDailyLoss,
  maxDrawdownPercent = 0.2, // 20% default safety breaker
}) {
  // ==============================
  // 🔐 CAPITAL AUTHORITY
  // ==============================

  let equity = startingEquity;
  let peakEquity = startingEquity;

  let dailyLoss = 0;
  let tradingHalted = false;

  // ==============================
  // 🧠 TRADE PERMISSION
  // ==============================

  function canTakeTrade() {
    if (tradingHalted) return false;

    const maxLossAmount = equity * maxDailyLoss;
    return dailyLoss < maxLossAmount && equity > 0;
  }

  // ==============================
  // 📉 AFTER TRADE UPDATE
  // ==============================

  function updateAfterTrade(pnl) {
    equity += pnl;

    // 🛑 Hard capital floor
    if (equity <= 0) {
      equity = 0;
      tradingHalted = true;
    }

    // 📈 Track peak equity for drawdown control
    if (equity > peakEquity) {
      peakEquity = equity;
    }

    // 📉 Track daily loss
    if (pnl < 0) {
      dailyLoss += Math.abs(pnl);
    }

    // 🛑 Drawdown circuit breaker
    const drawdownThreshold = peakEquity * (1 - maxDrawdownPercent);
    if (equity <= drawdownThreshold) {
      tradingHalted = true;
    }
  }

  // ==============================
  // 📊 POSITION SIZING
  // ==============================

  function calculatePositionSize({
    entryPrice,
    stopPrice,
  }) {
    if (equity <= 0) return 0;

    const riskAmount = equity * riskPerTrade;
    const riskPerUnit = Math.abs(entryPrice - stopPrice);

    if (riskPerUnit === 0) return 0;

    const size = riskAmount / riskPerUnit;

    // Prevent risking more than equity (extreme slippage guard)
    if (riskAmount > equity) return 0;

    return size;
  }

  // ==============================
  // 🔄 DAILY RESET
  // ==============================

  function resetDailyLoss() {
    dailyLoss = 0;
  }

  function setDailyLoss(amount) {
    dailyLoss = amount;
  }

  function getDailyLoss() {
    return dailyLoss;
  }

  function getEquity() {
    return equity;
  }

  function isTradingHalted() {
    return tradingHalted;
  }

  return {
    canTakeTrade,
    calculatePositionSize,
    updateAfterTrade,
    resetDailyLoss,
    setDailyLoss,
    getDailyLoss,
    getEquity,
    isTradingHalted,
  };
}

module.exports = { createRiskEngine };