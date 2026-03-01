const TelegramBot = require("node-telegram-bot-api");

/**
 * Telegram command handler (controlled access)
 * Stable polling version (NO Markdown fragility)
 */

function safeNum(n) {
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

// 🔒 GLOBAL TRADE CONTROL (entry gate only)
const tradeControl = {
  enabled: true,
};

// 🧠 simple rate limiter (prevents 429 + deaf bot)
let lastReplyAt = 0;
function canReply() {
  const now = Date.now();
  if (now - lastReplyAt < 1500) return false;
  lastReplyAt = now;
  return true;
}

let botInstance = null; // 🚨 SINGLETON GUARD

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

  // 🚫 PREVENT MULTIPLE INSTANCES
  if (botInstance) {
    log("⚠️ Telegram bot already running — skipping duplicate init");
    return;
  }

  const bot = new TelegramBot(token, {
    polling: { interval: 300, autoStart: true },
  });

  botInstance = bot;
  log("🤖 Telegram bot started (polling, single instance)");

  function isAuthorized(msg) {
    return msg.chat && msg.chat.id === ALLOWED_CHAT_ID;
  }

  // 🚨 Unauthorized access logging (quiet)
  bot.on("message", (msg) => {
    if (!isAuthorized(msg)) {
      log(`🚫 Unauthorized Telegram access from chat ${msg.chat.id}`);
    }
  });

  // ===========================
  // /status
  // ===========================
  bot.onText(/\/status/, (msg) => {
    if (!isAuthorized(msg) || !canReply()) return;

    const chatId = msg.chat.id;

    let text = "📊 System Status\n\n";

    for (const symbol of Object.keys(engines)) {
      const engine = engines[symbol];
      text += `${symbol}\n`;
      text += `Bias (${biasTF}): ${engine.getBias()}\n`;
      text += `Structure (${structureTF}): ${engine.getStructure()}\n\n`;
    }

    text += `Feed: ${feedHealth.getStatus()}\n`;
    text += `Trading: ${tradeControl.enabled ? "ACTIVE" : "PAUSED"}\n`;
    text += `Open Position: ${executor.hasOpenPosition() ? "YES" : "NO"}\n`;
    text += `Equity: ${safeNum(account.equity)}\n`;

    bot.sendMessage(chatId, text).catch(() => {});
  });

  // ===========================
  // /performance
  // ===========================
  bot.onText(/\/performance/, (msg) => {
    if (!isAuthorized(msg) || !canReply()) return;

    const chatId = msg.chat.id;

    try {
      const s = performanceTracker.getSummary();

      const text =
        "📈 Performance Summary\n\n" +
        `Trades: ${s.totalTrades ?? 0}\n` +
        `Wins: ${s.wins ?? 0}\n` +
        `Losses: ${s.losses ?? 0}\n\n` +
        `Net PnL: ${safeNum(s.netPnl)}\n` +
        `Avg R: ${safeNum(s.avgR)}\n` +
        `Equity: ${safeNum(s.equity)}\n`;

      bot.sendMessage(chatId, text).catch(() => {});
    } catch (err) {
      log("❌ /performance error:", err.message);
      bot.sendMessage(chatId, "⚠️ Performance data not ready").catch(() => {});
    }
  });

  // ===========================
  // /position
  // ===========================
  bot.onText(/\/position/, (msg) => {
    if (!isAuthorized(msg) || !canReply()) return;

    const chatId = msg.chat.id;
    const pos = account.openPosition;

    if (!pos) {
      bot.sendMessage(chatId, "📍 No open position").catch(() => {});
      return;
    }

    const text =
      "📍 Open Position\n" +
      `Symbol: ${pos.symbol}\n` +
      `Side: ${pos.side}\n` +
      `Stop: ${pos.stop}\n` +
      `Take Profit: ${pos.takeProfit}\n` +
      `Entry Equity: ${pos.entryEquity.toFixed(2)}\n`;

    bot.sendMessage(chatId, text).catch(() => {});
  });

  // ===========================
  // /pause
  // ===========================
  bot.onText(/\/pause/, (msg) => {
    if (!isAuthorized(msg) || !canReply()) return;

    const chatId = msg.chat.id;

    if (!tradeControl.enabled) {
      bot.sendMessage(chatId, "⏸️ Trading already paused").catch(() => {});
      return;
    }

    tradeControl.enabled = false;
    log("⏸️ Trading PAUSED via Telegram");
    bot.sendMessage(chatId, "⏸️ Trading paused").catch(() => {});
  });

  // ===========================
  // /resume
  // ===========================
  bot.onText(/\/resume/, (msg) => {
    if (!isAuthorized(msg) || !canReply()) return;

    const chatId = msg.chat.id;

    if (tradeControl.enabled) {
      bot.sendMessage(chatId, "▶️ Trading already active").catch(() => {});
      return;
    }

    tradeControl.enabled = true;
    log("▶️ Trading RESUMED via Telegram");
    bot.sendMessage(chatId, "▶️ Trading resumed").catch(() => {});
  });

  // ===========================
  // /trading
  // ===========================
  bot.onText(/\/trading/, (msg) => {
    if (!isAuthorized(msg) || !canReply()) return;

    const chatId = msg.chat.id;
    bot.sendMessage(
      chatId,
      `⚙️ Trading is ${tradeControl.enabled ? "ACTIVE" : "PAUSED"}`
    ).catch(() => {});
  });

  // ===========================
  // 🔔 NOTIFICATIONS
  // ===========================
  function notifyTradeOpen(trade) {
    bot.sendMessage(
      ALLOWED_CHAT_ID,
      "🟢 Trade Opened\n" +
        `Symbol: ${trade.symbol}\n` +
        `Side: ${trade.side}\n` +
        `Entry: ${trade.entryPrice}\n` +
        `SL: ${trade.stopPrice}\n` +
        `TP: ${trade.takeProfitPrice}\n` +
        `Size: ${trade.size.toFixed(4)}`
    ).catch(() => {});
  }

  function notifyTradeClose(trade) {
    bot.sendMessage(
      ALLOWED_CHAT_ID,
      "🔴 Trade Closed\n" +
        `Symbol: ${trade.symbol}\n` +
        `Side: ${trade.side}\n` +
        `PnL: ${safeNum(trade.pnl)}\n` +
        `R: ${safeNum(trade.r)}\n` +
        `Duration: ${trade.durationMinutes.toFixed(1)} min\n` +
        `Equity: ${safeNum(trade.equity)}`
    ).catch(() => {});
  }

  function notifySystemAlert(message) {
  bot.sendMessage(
    ALLOWED_CHAT_ID,
    "🚨 SYSTEM ALERT\n" + message
  ).catch(() => {});
}

  function notifyDailyExecutionSummary(summary) {
  if (!summary) return;

  let message = "📊 Exchange Feedback (Bybit)\n\n";

  const exchange = summary.exchange || { total: 0, breakdown: [] };
  const internal = summary.internal || { total: 0, breakdown: [] };

  message += `Total exchange rejects: ${exchange.total}\n`;

  if (exchange.topIssue) {
    const top = exchange.topIssue;
    message += `Top issue: ${top.code} - ${top.message} (${top.count}x)\n`;
  }

  if (exchange.breakdown && exchange.breakdown.length > 0) {
    message += "\nAll Exchange Issues:\n";
    for (const e of exchange.breakdown) {
      message += `- ${e.code}: ${e.message} (${e.count}x)\n`;
    }
  }

  if (internal.total > 0) {
    message += "\nInternal Rejections:\n";
    for (const i of internal.breakdown) {
      message += `- ${i.reason}: ${i.count}\n`;
    }
  }

  if (exchange.total === 0 && internal.total === 0) {
    message += "\nNo rejects today. Clean execution.\n";
  }

  bot.sendMessage(ALLOWED_CHAT_ID, message).catch(() => {});
}

  // 🔁 EXPORT HOOKS
  startTelegramBot.tradeControl = tradeControl;
  startTelegramBot.notifyTradeOpen = notifyTradeOpen;
  startTelegramBot.notifyTradeClose = notifyTradeClose;
  startTelegramBot.notifyDailyExecutionSummary = notifyDailyExecutionSummary;
  startTelegramBot.notifySystemAlert = notifySystemAlert;
}

module.exports = { startTelegramBot };