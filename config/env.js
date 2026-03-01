const dotenv = require("dotenv");

dotenv.config();

function requireEnv(key) {
  if (!process.env[key]) {
    throw new Error(`❌ Missing required env variable: ${key}`);
  }
  return process.env[key];
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  appName: process.env.APP_NAME || "paper-trading-bot",

  riskPerTrade: Number(requireEnv("RISK_PER_TRADE")),
  maxDailyLossPercent: Number(requireEnv("MAX_DAILY_LOSS_PERCENT")),
};

module.exports = env;