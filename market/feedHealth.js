/**
 * Feed health monitor
 * Tracks price feed downtime and classifies severity
 */
function createFeedHealth({ log }) {
  const ENTRY_HALT_MS = 60_000; // ~60 seconds
  const DANGER_MS = 10 * 60_000; // ~10 minutes

  let lastTickAt = Date.now();
  let dangerEmitted = false;

  function recordTick() {
    lastTickAt = Date.now();
    dangerEmitted = false;
  }

  function getStatus() {
    const now = Date.now();
    const downtime = now - lastTickAt;

    if (downtime >= DANGER_MS) {
      if (!dangerEmitted) {
        log("🚨 FEED DANGER — price feed down > 10 minutes");
        dangerEmitted = true;
      }
      return "DANGER";
    }

    if (downtime >= ENTRY_HALT_MS) {
      return "HALT_ENTRIES";
    }

    return "OK";
  }

  return {
    recordTick,
    getStatus,
  };
}

module.exports = { createFeedHealth };