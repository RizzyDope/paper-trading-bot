const TelegramBot = require("node-telegram-bot-api");

/**
 * Read-only Telegram command handler (restricted access)
 */

function safeNum(n) {
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function startTelegramBot({
  token,
  account,
  paperExecutor,
  performanceTracker,
  feedHealth,
  getBias,
  getStructure,
  structureTF,
  biasTF,
  log,
}) {
  if (!token) {
    log("⚠️ Telegram token missing — bot disabled");
    return;
  }

  const ALLOWED_CHAT_ID = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);

  if (!ALLOWED_CHAT_ID) {
    log("⚠️ TELEGRAM_ALLOWED_CHAT_ID missing — bot disabled");
    return;
  }

  const bot = new TelegramBot(token, { polling: true });

  log("🤖 Telegram bot started (READ-ONLY, restricted)");

  function isAuthorized(msg) {
    return msg.chat.id === ALLOWED_CHAT_ID;
  }

  // Log unauthorized attempts
  bot.on("message", (msg) => {
    if (!isAuthorized(msg)) {
      log(`🚫 Unauthorized Telegram access attempt from chat ${msg.chat.id}`);
    }
  });

  // /status
  bot.onText(/\/status/, (msg) => {
    if (!isAuthorized(msg)) return;

    const chatId = msg.chat.id;

    const status = `
📊 *System Status*
• Bias (${biasTF}): ${getBias()}
• Structure (${structureTF}): ${getStructure()}
• Feed: ${feedHealth.getStatus()}
• Open Position: ${paperExecutor.hasOpenPosition() ? "YES" : "NO"}
• Equity: ${account.equity.toFixed(2)}
`;

    bot.sendMessage(chatId, status, { parse_mode: "Markdown" });
  });

  // /performance
  bot.onText(/\/performance/, (msg) => {
    if (!isAuthorized(msg)) return;

    const chatId = msg.chat.id;

    try {
      const summary = performanceTracker.getSummary();

      const text = `
📈 *Performance Summary*

Trades: ${summary.totalTrades ?? 0}
Wins: ${summary.wins ?? 0}
Losses: ${summary.losses ?? 0}

Net PnL: ${safeNum(summary.netPnl)}
Avg R: ${safeNum(summary.avgR)}
Equity: ${safeNum(summary.equity)}
`;

      bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch (err) {
      log("❌ /performance error:", err.message);
      bot.sendMessage(chatId, "⚠️ Performance data not ready yet");
    }
  });

  // /position
  bot.onText(/\/position/, (msg) => {
    if (!isAuthorized(msg)) return;

    const chatId = msg.chat.id;
    const pos = account.openPosition;

    if (!pos) {
      bot.sendMessage(chatId, "📍 No open position");
      return;
    }

    const text = `
📍 *Open Position*
• Side: ${pos.side}
• Entry: ${pos.entryPrice}
• Stop: ${pos.stopPrice}
• Take Profit: ${pos.takeProfitPrice}
• Size: ${pos.size.toFixed(4)}
`;

    bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });
}

module.exports = { startTelegramBot };