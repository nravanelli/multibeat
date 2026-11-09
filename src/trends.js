export const MAX_TREND_MS = 60 * 60 * 1000;

/** Bound display history independently of the full-resolution recording. */
export function appendTrend(history, at, value, { everyMs = 1000, maxPoints = 3601 } = {}) {
  const last = history.at(-1);
  const point = { at, value };
  if (last && everyMs > 0 && Math.floor(last.at / everyMs) === Math.floor(at / everyMs)) history[history.length - 1] = point;
  else history.push(point);
  while (history.length && (history[0].at < at - MAX_TREND_MS || history.length > maxPoints)) history.shift();
}

/** Plot reported intervals on a bounded receipt-anchored relative beat timeline. */
export function appendRRTrend(history, sample, at, clock = {}) {
  const intervals = sample.rrMs;
  if (sample.contact === false || intervals.some(rr => !Number.isFinite(rr) || rr <= 0)) {
    clock.beatTime = null; clock.lastAt = at; return;
  }
  if (!intervals.length) return;
  const sum = intervals.reduce((a, b) => a + b, 0);
  if (clock.lastAt != null && (at < clock.lastAt || at - clock.lastAt > 5000) ||
      clock.beatTime != null && Math.abs(clock.beatTime + sum - at) > 5000) clock.beatTime = null;
  if (clock.beatTime == null) clock.beatTime = at - sum;
  clock.lastAt = at;
  for (const rr of intervals) {
    clock.beatTime += rr;
    appendTrend(history, clock.beatTime, rr, { everyMs: 0, maxPoints: 24001 });
  }
}
