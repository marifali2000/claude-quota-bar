// Pure quota logic: no vscode import, so it is unit-testable with node:test.

export type WindowKey = 'session' | 'weekly';
export type Level = 'ok' | 'warn' | 'critical';

export interface RawWindow {
  used_percentage: number;
  resets_at: number; // unix epoch seconds
}

/** The conversation that last reported, as the plugin or the bridge saw it. */
export interface SessionStats {
  id?: string;
  model?: string;
  contextPercent?: number;
  contextTokens?: number;
  contextWindow?: number;
  costUsd?: number;
  cacheHitRatio?: number; // terminal sessions only
}

export interface QuotaState {
  version: number;
  updatedAt: number; // unix epoch seconds of the last Claude Code response
  session?: SessionStats;
  rate_limits: { five_hour?: RawWindow; seven_day?: RawWindow };
}

export interface Thresholds {
  warnAt: number;
  criticalAt: number;
}

export interface WindowView {
  key: WindowKey;
  usedPct: number;
  resetsAt: number;
  secondsLeft: number;
  /** Fraction of the window's duration already elapsed, 0..1. */
  elapsed: number;
  /** Seconds until 100% at the average pace so far; null when nothing is used yet. */
  secondsToFull: number | null;
  /** True when the average pace so far runs out before the window resets. */
  runsOutBeforeReset: boolean;
  level: Level;
}

export const WINDOW_SECONDS: Record<WindowKey, number> = {
  session: 5 * 3600,
  weekly: 7 * 86400,
};

export const LABEL: Record<WindowKey, string> = {
  session: 'Session (5h)',
  weekly: 'Weekly (7d)',
};

export function rawFor(state: QuotaState | undefined, key: WindowKey): RawWindow | undefined {
  const rl = state?.rate_limits;
  return key === 'session' ? rl?.five_hour : rl?.seven_day;
}

export function levelFor(usedPct: number, t: Thresholds): Level {
  if (usedPct >= t.criticalAt) return 'critical';
  if (usedPct >= t.warnAt) return 'warn';
  return 'ok';
}

/** Undefined when there is no reading or the window has already reset. */
export function viewWindow(
  key: WindowKey,
  raw: RawWindow | undefined,
  nowSec: number,
  t: Thresholds,
): WindowView | undefined {
  if (!raw || raw.resets_at <= nowSec) return undefined;

  const length = WINDOW_SECONDS[key];
  const secondsLeft = raw.resets_at - nowSec;
  const elapsedSec = Math.min(length, Math.max(0, length - secondsLeft));
  const usedPct = Math.max(0, raw.used_percentage);

  let secondsToFull: number | null = null;
  if (usedPct >= 100) secondsToFull = 0;
  else if (usedPct > 0 && elapsedSec > 0) secondsToFull = ((100 - usedPct) / usedPct) * elapsedSec;

  return {
    key,
    usedPct,
    resetsAt: raw.resets_at,
    secondsLeft,
    elapsed: elapsedSec / length,
    secondsToFull,
    runsOutBeforeReset: secondsToFull !== null && secondsToFull < secondsLeft,
    level: levelFor(usedPct, t),
  };
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

// ── glyphs ──────────────────────────────────────────────────────────────

export const GLYPHS: Record<string, [filled: string, empty: string]> = {
  blocks: ['▰', '▱'],
  dots: ['●', '○'],
  squares: ['■', '□'],
  diamonds: ['◆', '◇'],
  smooth: ['█', '░'],
};

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

/** Tight form for the status bar: 2h10m, 1d4h, 45m. */
export function compactDuration(seconds: number): string {
  return formatDuration(seconds).replace(' ', '');
}

export function bar(pct: number, width: number, glyphs = 'blocks'): string {
  if (width <= 0) return '';
  const [full, empty] = GLYPHS[glyphs] ?? GLYPHS.blocks;
  const clamped = Math.min(100, Math.max(0, pct));
  if (glyphs === 'smooth') {
    const eighths = Math.round((clamped / 100) * width * 8);
    const whole = Math.floor(eighths / 8);
    const part = EIGHTHS[eighths % 8];
    return (full.repeat(whole) + part + empty.repeat(width)).slice(0, width);
  }
  const filled = Math.round((clamped / 100) * width);
  return full.repeat(filled) + empty.repeat(width - filled);
}

/** One cell of a segmented meter: lit or not, and the percent its colour stands for. */
export interface Segment {
  lit: boolean;
  at: number;
}

export function segments(pct: number, count: number): Segment[] {
  const step = 100 / count;
  return Array.from({ length: count }, (_, i) => ({ lit: pct >= (i + 0.5) * step, at: (i + 0.5) * step }));
}

// ── colour ──────────────────────────────────────────────────────────────

export interface Palette {
  ok: string;
  warn: string;
  critical: string;
}

export const PALETTES: Record<string, Palette> = {
  subtle: { ok: '#8FBC8F', warn: '#D7BA7D', critical: '#E08A80' },
  vivid: { ok: '#3FB950', warn: '#D29922', critical: '#F85149' },
  pastel: { ok: '#A8E6CF', warn: '#FFD3A5', critical: '#FFAAA5' },
  neon: { ok: '#39FF88', warn: '#FFE600', critical: '#FF2E63' },
  ocean: { ok: '#4FB3BF', warn: '#E9C46A', critical: '#E76F51' },
  colorblind: { ok: '#56B4E9', warn: '#E69F00', critical: '#D55E00' },
};

export type ColorMode = 'bands' | 'gradient';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

function rgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function hex2(n: number): string {
  return Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
}

export function mix(a: string, b: string, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return `#${hex2(ar + (br - ar) * k)}${hex2(ag + (bg - ag) * k)}${hex2(ab + (bb - ab) * k)}`.toUpperCase();
}

/** #RRGGBB → #RRGGBBAA; alpha 1 returns the colour unchanged. */
export function withAlpha(hex: string, alpha: number): string {
  if (alpha >= 1) return mix(hex, hex, 0);
  return `${mix(hex, hex, 0)}${hex2(alpha * 255).toUpperCase()}`;
}

/**
 * The colour for a percentage. `bands`: one flat colour per level. `gradient`:
 * the same bands, blending into the next colour over the 10 points before each
 * threshold, so everything well below the warning threshold is still pure ok.
 */
export function colorAt(pct: number, t: Thresholds, p: Palette, mode: ColorMode): string {
  if (mode === 'bands') return p[levelFor(pct, t)];
  if (pct >= t.criticalAt) return p.critical;
  const blend = (to: number, gap: number) => 1 - (to - pct) / Math.max(1, Math.min(10, gap));
  if (pct >= t.warnAt) return mix(p.warn, p.critical, blend(t.criticalAt, t.criticalAt - t.warnAt));
  return mix(p.ok, p.warn, blend(t.warnAt, t.warnAt));
}

// ── motion ──────────────────────────────────────────────────────────────

export function easeOutCubic(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return 1 - (1 - k) ** 3;
}

/** 0 → 1 → 0 over one period, quantised so most frames repeat and cost nothing. */
export function pulse(ms: number, period: number, steps = 8): number {
  const raw = (1 - Math.cos((2 * Math.PI * (ms % period)) / period)) / 2;
  return Math.round(raw * steps) / steps;
}

/**
 * The alert level that should fire now, or undefined. A level fires once per
 * window instance: `fired` holds keys from `alertKey` already used. Jumping
 * straight past both thresholds fires only critical.
 */
export function pendingAlert(view: WindowView, fired: ReadonlySet<string>): Level | undefined {
  if (view.level === 'ok') return undefined;
  if (fired.has(alertKey(view, view.level))) return undefined;
  if (view.level === 'warn' && fired.has(alertKey(view, 'critical'))) return undefined;
  return view.level;
}

/** Identifies one threshold in one window instance (a 5h or 7d period). */
export function alertKey(view: Pick<WindowView, 'key' | 'resetsAt'>, level: Level): string {
  // resets_at can wobble by a second between responses; bucket to 10 minutes.
  return `${view.key}-${Math.round(view.resetsAt / 600)}-${level}`;
}

export function shouldNotify(mode: string, level: Level): boolean {
  if (level === 'ok' || mode === 'off') return false;
  return mode === 'warnAndCritical' || level === 'critical';
}
