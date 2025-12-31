const env = require("../config/env");

function createPaperAccount() {
  return {
    equity: env.startingEquity,
    riskPerTrade: env.riskPerTrade,
    maxDailyLoss: env.maxDailyLoss,

    dailyLoss: 0,
    openPosition: null,
    currentPrice: 0
  };
}

module.exports = createPaperAccount;