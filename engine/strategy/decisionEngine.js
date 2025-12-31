/**
 * Decides whether to act based on evaluated signals
 * @param {Object} params
 * @param {"BULLISH"|"BEARISH"|"NEUTRAL"} params.bias
 * @param {"BULLISH_STRUCTURE"|"BEARISH_STRUCTURE"|"RANGE"} params.structure
 * @param {"LONG_ENTRY"|"SHORT_ENTRY"|null} params.entry
 * @param {boolean} params.hasOpenPosition
 * @param {boolean} params.riskAllowed
 */
function decide({
  bias,
  structure,
  entry,
  hasOpenPosition,
  riskAllowed, 
}) {
  if (!riskAllowed) return "HOLD";
  if (hasOpenPosition) return "HOLD";

  if (entry === "LONG_ENTRY") return "ENTER_LONG";
  if (entry === "SHORT_ENTRY") return "ENTER_SHORT";

  return "HOLD";
}

module.exports = { decide };