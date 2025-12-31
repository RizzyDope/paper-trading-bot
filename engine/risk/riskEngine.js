/**
 * Risk Engine
 * Controls whether new trades are allowed
 */

function createRiskEngine({
  startingEquity,
  riskPerTrade,
  maxDailyLoss,
}) {
  let dailyLoss = 0;

  function canTakeTrade() {
    const maxLossAmount = startingEquity * maxDailyLoss;
    return dailyLoss < maxLossAmount;
  }

  function registerLoss(amount) {
    dailyLoss += amount;
  }

  function resetDailyLoss() {
    dailyLoss = 0;
  }

  function calculatePositionSize({
    entryPrice,
    stopPrice,
    equity,
  }) {
    const riskAmount = equity * riskPerTrade;
    const riskPerUnit = Math.abs(entryPrice - stopPrice);

    if (riskPerUnit === 0) return 0;

    return riskAmount / riskPerUnit;
  }

  return {
    canTakeTrade,
    registerLoss,
    resetDailyLoss,
    calculatePositionSize,
  };
}

module.exports = { createRiskEngine };