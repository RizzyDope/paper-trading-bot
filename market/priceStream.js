const WebSocket = require("ws");
const { log } = require("../core/logger");

/**
 * Starts a Bybit multi-symbol orderbook stream
 * Emits: onPrice({ symbol, bid, ask, timestamp })
 */
function startPriceStream(onPrice, feedHealth) {
  const url = "wss://stream-testnet.bybit.com/v5/public/linear";
  const symbols = ["BTCUSDT", "TRXUSDT"];

  let ws = null;
  let reconnectTimeout = null;
  const RECONNECT_DELAY_MS = 5000;

  let tickCount = 0;
  let lastTickLog = Date.now();

  function connect() {
    ws = new WebSocket(url);

    ws.on("open", () => {
      log("📡 Connected to Bybit orderbook stream");

      const args = symbols.map((s) => `orderbook.1.${s}`);

      ws.send(
        JSON.stringify({
          op: "subscribe",
          args,
        })
      );

      log(`📡 Subscribed to: ${symbols.join(", ")}`);
    });

    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (!msg.topic || !msg.data) return;

      const symbol = msg.topic.replace("orderbook.1.", "");
      const bids = msg.data.b;
      const asks = msg.data.a;

      if (!bids?.length || !asks?.length) return;

      const bid = Number(bids[0][0]);
      const ask = Number(asks[0][0]);
      const timestamp = msg.ts || Date.now();

      if (Number.isNaN(bid) || Number.isNaN(ask)) return;

      tickCount++;
      const now = Date.now();
      if (now - lastTickLog >= 60_000) {
        log(`📈 WS alive — ${tickCount} updates`);
        lastTickLog = now;
      }

      feedHealth.recordTick();

      onPrice({ symbol, bid, ask, timestamp });
    });

    ws.on("error", (err) => {
      log(`❌ WebSocket error: ${err.message}`);
      ws.close();
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