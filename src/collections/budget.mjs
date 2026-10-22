// Process-wide for this application instance, independent of demo identities
// and resets. Only actual model calls consume the budget; cached drafts do not.
// Multi-process deployments need a shared limiter before enabling real users.
export function limitGenerator(generator, { maxCallsPerMinute = 12, maxConcurrent = 2 } = {}) {
  if (typeof generator !== 'function'
    || !Number.isSafeInteger(maxCallsPerMinute) || maxCallsPerMinute < 1 || maxCallsPerMinute > 120
    || !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 10) {
    throw new TypeError('Invalid AI call budget');
  }
  let starts = [];
  let active = 0;
  return async input => {
    const now = performance.now();
    starts = starts.filter(time => now - time < 60_000);
    if (active >= maxConcurrent || starts.length >= maxCallsPerMinute) {
      // The collections service turns this into its safe AI_UNAVAILABLE error.
      throw new Error('AI call budget exhausted');
    }
    starts.push(now);
    active++;
    try { return await generator(input); }
    finally { active--; }
  };
}
