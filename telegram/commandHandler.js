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
  engines,
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

  // /status (MULTI-SYMBOL)
  bot.onText(/\/status/, (msg) => {
    if (!isAuthorized(msg)) return;

    const chatId = msg.chat.id;

    let text = `📊 *System Status*\n\n`;

    for (const symbol of Object.keys(engines)) {
      const engine = engines[symbol];

      text += `*${symbol}*\n`;
      text += `• Bias (${biasTF}): ${engine.getBias()}\n`;
      text += `• Structure (${structureTF}): ${engine.getStructure()}\n\n`;
    }

    text += `• Feed: ${feedHealth.getStatus()}\n`;
    text += `• Trading: ${tradeControl.enabled ? "ACTIVE" : "PAUSED"}\n`;
    text += `• Open Position: ${executor.hasOpenPosition() ? "YES" : "NO"}\n`;
    text += `• Equity: ${account.equity.toFixed(2)}\n`;

    bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
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

  // =====================================================
  // 🔔 TRADE NOTIFICATIONS (NEW — NON-BREAKING)
  // =====================================================

  function notifyTradeOpen(trade) {
    bot.sendMessage(
      ALLOWED_CHAT_ID,
      `🟢 *Trade Opened*
Symbol: ${trade.symbol}
Side: ${trade.side}
Entry: ${trade.entryPrice}
SL: ${trade.stopPrice}
TP: ${trade.takeProfitPrice}
Size: ${trade.size.toFixed(4)}`
    );
  }

  function notifyTradeClose(trade) {
    bot.sendMessage(
      ALLOWED_CHAT_ID,
      `🔴 *Trade Closed* (${trade.reason})
Symbol: ${trade.symbol}
Side: ${trade.side}
PnL: ${safeNum(trade.pnl)}
R: ${safeNum(trade.r)}
Duration: ${trade.durationMinutes.toFixed(1)} min
Equity: ${safeNum(trade.equity)}`
    );
  }

  function notifyDailyExecutionSummary(summary) {
  if (!summary || summary.totalRejects === 0) return;

  let message = `📊 *Exchange Feedback (Bybit)*\n`;

  message += `Total rejects: ${summary.exchange.total}\n`;

  if (summary.exchange.topIssue) {
    const top = summary.exchange.topIssue;
    message += `Top issue: ${top.code} - ${top.message} (${top.count}x)\n`;
  }

  if (summary.exchange.breakdown.length > 1) {
    message += `\n*All Exchange Issues*\n`;
    for (const e of summary.exchange.breakdown) {
      message += `• ${e.code} - ${e.message} (${e.count}x)\n`;
    }
  }

  if (summary.internal.total > 0) {
    message += `\n📋 *Internal Rejections*\n`;
    for (const i of summary.internal.breakdown) {
      message += `• ${i.reason}: ${i.count}\n`;
    }
  }

  bot.sendMessage(ALLOWED_CHAT_ID, message, { parse_mode: "Markdown" });
}

  // 🔁 EXPORT CONTROL + NOTIFIERS
  startTelegramBot.tradeControl = tradeControl;
  startTelegramBot.notifyTradeOpen = notifyTradeOpen;
  startTelegramBot.notifyTradeClose = notifyTradeClose;
  startTelegramBot.notifyDailyExecutionSummary = notifyDailyExecutionSummary;
}

module.exports = { startTelegramBot };