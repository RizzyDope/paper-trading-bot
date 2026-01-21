const TelegramBot = require("node-telegram-bot-api");

/**
 * Telegram command handler (controlled access)
 * Supports pause/resume WITHOUT affecting open positions
 */

function safeNum(n) {
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

// 🔒 GLOBAL TRADE CONTROL (entry gate only)
const tradeControl = {
  enabled: true,
};

function startTelegramBot({
  token,
  account,
  executor,
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

  log("🤖 Telegram bot started (CONTROL ENABLED, restricted)");

  function isAuthorized(msg) {
    return msg.chat.id === ALLOWED_CHAT_ID;
  }

  // 🚨 Log unauthorized access attempts
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
• Trading: ${tradeControl.enabled ? "ACTIVE" : "PAUSED"}
• Open Position: ${executor.hasOpenPosition() ? "YES" : "NO"}
• Equity: ${account.equity.toFixed(2)}
`;

    bot.sendMessage(chatId, status);
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

      bot.sendMessage(chatId, text);
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

    bot.sendMessage(chatId, text);
  });

  // ⏸️ /pause — stop NEW trades only
  bot.onText(/\/pause/, (msg) => {
    if (!isAuthorized(msg)) return;

    const chatId = msg.chat.id;

    if (!tradeControl.enabled) {
      bot.sendMessage(chatId, "⏸️ Trading is already paused");
      return;
    }

    tradeControl.enabled = false;
    log("⏸️ Trading PAUSED via Telegram");

    bot.sendMessage(
      chatId,
      "⏸️ *Trading paused*\nExisting positions remain managed normally."
    );
  });

  // ▶️ /resume — allow new trades
  bot.onText(/\/resume/, (msg) => {
    if (!isAuthorized(msg)) return;

    const chatId = msg.chat.id;

    if (tradeControl.enabled) {
      bot.sendMessage(chatId, "▶️ Trading is already active");
      return;
    }

    tradeControl.enabled = true;
    log("▶️ Trading RESUMED via Telegram");

    bot.sendMessage(chatId, "▶️ *Trading resumed*");
  });

  // /trading — explicit check
  bot.onText(/\/trading/, (msg) => {
    if (!isAuthorized(msg)) return;

    const chatId = msg.chat.id;

    bot.sendMessage(
      chatId,
      `⚙️ Trading is currently *${tradeControl.enabled ? "ACTIVE" : "PAUSED"}*`
    );
  });

  // 🔁 EXPORT CONTROL FOR STRATEGY ENGINE
  startTelegramBot.tradeControl = tradeControl;
}

module.exports = { startTelegramBot };