/**
 * Binance-Authoritative Risk Engine
 * No local equity. No synthetic resets.
 */

function createRiskEngine({
  riskPerTrade,
  maxDailyLossPercent,
}) {
  // ==============================
  // 📅 BINANCE UTC AUTHORITY
  // ==============================

  let currentUTCDate = null;
  let dailyStartEquity = 0;
  let maxDailyLossAmount = 0;
  let isDailyHalted = false;

  // ==============================
  // 🔄 INITIALIZE NEW UTC DAY
  // ==============================

  function initializeNewDay(equity, utcDate) {
    currentUTCDate = utcDate;
    dailyStartEquity = equity;
    maxDailyLossAmount = equity * maxDailyLossPercent;
    isDailyHalted = false;
  }

  // ==============================
  // 🛑 CHECK DAILY LIMIT
  // ==============================

  function checkDailyLimit(currentEquity) {
    const drawdown = dailyStartEquity - currentEquity;

    if (drawdown >= maxDailyLossAmount) {
      isDailyHalted = true;
    }
  }

  // ==============================
  // 🧠 TRADE PERMISSION
  // ==============================

  function canTakeTrade(currentEquity) {
    if (isDailyHalted) return false;

    checkDailyLimit(currentEquity);

    return !isDailyHalted && currentEquity > 0;
  }

  // ==============================
  // 📊 POSITION SIZING (LIVE EQUITY)
  // ==============================

  function calculatePositionSize({
    entryPrice,
    stopPrice,
    currentEquity,
  }) {
    if (currentEquity <= 0) return 0;

    const riskAmount = currentEquity * riskPerTrade;
    const riskPerUnit = Math.abs(entryPrice - stopPrice);

    if (riskPerUnit === 0) return 0;

    return riskAmount / riskPerUnit;
  }

  function isTradingHalted() {
    return isDailyHalted;
  }

  function getDailyStartEquity() {
    return dailyStartEquity;
  }

  function getMaxDailyLossAmount() {
    return maxDailyLossAmount;
  }

  function getCurrentUTCDate() {
    return currentUTCDate;
  }

  return {
    initializeNewDay,
    canTakeTrade,
    calculatePositionSize,
    isTradingHalted,
    getDailyStartEquity,
    getMaxDailyLossAmount,
    getCurrentUTCDate,
  };
}

module.exports = { createRiskEngine };