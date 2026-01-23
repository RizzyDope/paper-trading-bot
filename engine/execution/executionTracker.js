
function createExecutionTracker() {
  const exchangeRejects = {};

  const internalRejects = {};

  // -----------------------------
  // RECORDERS
  // -----------------------------

  function recordExchangeReject(code, message) {
    if (!code) return;

    if (!exchangeRejects[code]) {
      exchangeRejects[code] = {
        count: 0,
        message: message || "Unknown error",
      };
    }

    exchangeRejects[code].count += 1;
  }

  function recordInternalReject(reason) {
    if (!reason) return;

    if (!internalRejects[reason]) {
      internalRejects[reason] = 0;
    }

    internalRejects[reason] += 1;
  }

  // -----------------------------
  // SUMMARY
  // -----------------------------

  function getSummary() {
    const exchangeEntries = Object.entries(exchangeRejects);
    const internalEntries = Object.entries(internalRejects);

    const totalExchangeRejects = exchangeEntries.reduce(
      (sum, [, v]) => sum + v.count,
      0
    );

    const totalInternalRejects = internalEntries.reduce(
      (sum, [, v]) => sum + v,
      0
    );

    const totalRejects = totalExchangeRejects + totalInternalRejects;

    // Find top exchange issue (if any)
    let topExchangeIssue = null;

    for (const [code, data] of exchangeEntries) {
      if (
        !topExchangeIssue ||
        data.count > topExchangeIssue.count
      ) {
        topExchangeIssue = {
          code,
          message: data.message,
          count: data.count,
        };
      }
    }

    return {
      totalRejects,

      exchange: {
        total: totalExchangeRejects,
        topIssue: topExchangeIssue, // may be null
        breakdown: exchangeEntries.map(([code, data]) => ({
          code,
          message: data.message,
          count: data.count,
        })),
      },

      internal: {
        total: totalInternalRejects,
        breakdown: internalEntries.map(([reason, count]) => ({
          reason,
          count,
        })),
      },
    };
  }

  // -----------------------------
  // RESET (DAILY)
  // -----------------------------

  function reset() {
    for (const k in exchangeRejects) delete exchangeRejects[k];
    for (const k in internalRejects) delete internalRejects[k];
  }

  return {
    recordExchangeReject,
    recordInternalReject,
    getSummary,
    reset,
  };
}

module.exports = { createExecutionTracker };