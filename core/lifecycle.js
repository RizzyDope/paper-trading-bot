const { log } = require("./logger");
const env = require("../config/env");

function start() {
  log(`🚀 ${env.appName} starting in ${env.nodeEnv} mode`);
}

function stop() {
  log("🛑 Application shutting down");
  process.exit(0);
}

module.exports = { start, stop };