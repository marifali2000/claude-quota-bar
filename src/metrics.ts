// Usage history and the rates derived from it. Pure: no vscode import.

import { WINDOW_SECONDS, WindowKey, WindowView } from './quota';

/** One reading: per window, [used percent, resets_at]. */
export interface Sample {
  t: number;
  session?: [number, number];
  weekly?: [number, number];
}

const MAX_AGE_SEC = 8 * 86400;
const MAX_SAMPLES = 5000;

const sameWindow = (a: number, b: number) => Math.round(a / 600) === Math.round(b / 600);

/**
 * Adds a reading when it differs from the last one. A value that holds is
 * implied until the next sample, so repeats add nothing.
 */
export function record(history: readonly Sample[], s: Sample): Sample[] {
  const last = history[history.length - 1];
  if (last && JSON.stringify([last.session, last.weekly]) === JSON.stringify([s.session, s.weekly])) return [...history];
  return [...history.filter((h) => h.t > s.t - MAX_AGE_SEC), s].slice(-MAX_SAMPLES);
}

/**
 * The usage at a moment in the window that resets at `resetsAt`: the newest
 * sample at or before it, else the window's earliest sample, with its time.
 */
export function valueAt(
  history: readonly Sample[],
  key: WindowKey,
  atSec: number,
  resetsAt: number,
): { value: number; t: number } | undefined {
  let found: { value: number; t: number } | undefined;
  for (const h of history) {
    const w = h[key];
    if (!w || !sameWindow(w[1], resetsAt)) continue;
    if (h.t <= atSec) found = { value: w[0], t: atSec };
    else return found ?? { value: w[0], t: h.t };
  }
  return found;
}

/** How much usage grew since `sinceSec`, and over how long. */
export function growth(
  history: readonly Sample[],
  v: WindowView,
  sinceSec: number,
  nowSec: number,
): { delta: number; spanSec: number; fromSec: number } | undefined {
  const start = v.resetsAt - WINDOW_SECONDS[v.key];
  if (sinceSec <= start) return { delta: v.usedPct, spanSec: nowSec - start, fromSec: start }; // the window began empty
  const base = valueAt(history, v.key, sinceSec, v.resetsAt);
  if (!base || nowSec <= base.t) return undefined;
  return { delta: Math.max(0, v.usedPct - base.value), spanSec: nowSec - base.t, fromSec: base.t };
}

export interface Rates {
  /** Average use per hour (session) or per day (weekly) since the window began. */
  average: number;
  /**
   * Session: use per hour over the last hour. Weekly: use since local midnight.
   * Absent until there is history to measure it from.
   */
  recent?: number;
  /** Where `recent` is measured from, when history starts later than asked (unix seconds). */
  recentFrom?: number;
  /** What is left per hour (session) or per day (weekly) to last until the reset. */
  room: number;
}

export function rates(history: readonly Sample[], v: WindowView, nowSec: number, midnightSec: number): Rates {
  const unit = v.key === 'session' ? 3600 : 86400;
  const elapsedUnits = (v.elapsed * WINDOW_SECONDS[v.key]) / unit;
  const leftUnits = v.secondsLeft / unit;
  const average = elapsedUnits > 0 ? v.usedPct / elapsedUnits : 0;
  const room = leftUnits > 0 ? Math.max(0, 100 - v.usedPct) / leftUnits : 0;

  // A rate over a few minutes of history says nothing; wait for enough of it.
  const since = v.key === 'session' ? nowSec - 3600 : midnightSec;
  const g = growth(history, v, since, nowSec);
  if (!g || g.spanSec < (v.key === 'session' ? 600 : 1800)) return { average, room };
  const recent = v.key === 'session' ? (g.delta / g.spanSec) * 3600 : g.delta;
  return { average, room, recent, recentFrom: g.fromSec > since + 60 ? g.fromSec : undefined };
}
