const WebSocket = require("ws");
const { log } = require("../core/logger");

/**
 * Starts a live price stream for BTCUSDT
 * Calls onPrice(price) whenever a new price arrives
 */
function startPriceStream(onPrice, feedHealth) {
  const url = "wss://stream.binance.com:9443/ws/btcusdt@trade";

  let ws = null;
  let reconnectTimeout = null;
  const RECONNECT_DELAY_MS = 5000;

  // 🔍 observability
  let tickCount = 0;
  let lastTickLog = Date.now();

  function connect() {
    ws = new WebSocket(url);

    ws.on("open", () => {
      log("📡 Connected to BTCUSDT price stream");
    });

    ws.on("message", (data) => {
      tickCount++;

      const now = Date.now();
      if (now - lastTickLog >= 60_000) {
        log(`📈 WS alive — ${tickCount} ticks received`);
        lastTickLog = now;
      }

      const parsed = JSON.parse(data.toString());

      // Binance sends price as string
      const price = Number(parsed.p);

      if (!Number.isNaN(price)) {
        // ✅ feed health heartbeat
        feedHealth.recordTick();

        onPrice(price);
      }
    });

    ws.on("error", (err) => {
      log(`❌ WebSocket error: ${err.message}`);
      ws.close(); // triggers close → reconnect
    });

    ws.on("close", () => {
      log("🔌 Price stream disconnected — reconnecting...");
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimeout) return;

    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  connect();
}

module.exports = { startPriceStream };