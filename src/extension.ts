import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as bridge from './bridge';
import { Sample, rates, record } from './metrics';
import {
  ColorMode,
  GLYPHS,
  LABEL,
  Level,
  PALETTES,
  Palette,
  QuotaState,
  Thresholds,
  WindowKey,
  WindowView,
  alertKey,
  bar,
  colorAt,
  compactDuration,
  easeOutCubic,
  formatDuration,
  isHex,
  levelFor,
  pendingAlert,
  pulse,
  rawFor,
  segments,
  shouldNotify,
  viewWindow,
  withAlpha,
} from './quota';
import { playSound } from './sound';
import { pickTip } from './tips';

const CFG = 'claudeQuota';
const KEYS: WindowKey[] = ['session', 'weekly'];
const SHORT: Record<WindowKey, string> = { session: '5h', weekly: '7d' };
const HISTORY_KEY = 'claudeQuota.history';

const TICK_MS = 30_000; // countdown, staleness and the next tip
const SWEEP_MS = 700;
const SPIN_MS = 1200;
const FLASH_MS = 4500;
const FLASH_STEP_MS = 450;
const PULSE_PERIOD_MS = 2400;
const DEMO_MS = 11_000;
const FAST_FRAME_MS = 50; // while sweeping, flashing or in the demo, each a few seconds
const PULSE_FRAME_MS = 200; // with 8 quantised steps, most frames change nothing

// ── configuration ─────────────────────────────────────────────────────────

interface Cfg {
  thresholds: Record<WindowKey, Thresholds>;
  palette: Palette;
  colorMode: ColorMode;
  background: string;
  collapsed: boolean;
  glyphs: string;
  text: string;
  barWidth: number;
  showWeekly: boolean;
  alignment: vscode.StatusBarAlignment;
  staleAfterSec: number;
  animate: boolean;
  sweep: boolean;
  spin: boolean;
  pulse: string;
  alertVisual: string;
  alertSound: string;
  soundFile: string;
  volume: number;
  statePath: string;
}

function readConfig(): Cfg {
  const c = vscode.workspace.getConfiguration(CFG);
  const thresholds = (key: WindowKey): Thresholds => {
    const warnAt = c.get<number>(`${key}.warnAt`, 60);
    const criticalAt = c.get<number>(`${key}.criticalAt`, 90);
    return { warnAt: Math.min(warnAt, criticalAt), criticalAt };
  };
  const base = PALETTES[c.get<string>('colors.palette', 'subtle')] ?? PALETTES.subtle;
  const pick = (k: keyof Palette) => {
    const v = c.get<string>(`colors.${k}`, '');
    return isHex(v) ? v : base[k];
  };
  const glyphs = c.get<string>('display.glyphs', 'blocks');
  const reduceMotion = vscode.workspace.getConfiguration('workbench').get<string>('reduceMotion') === 'on';

  return {
    thresholds: { session: thresholds('session'), weekly: thresholds('weekly') },
    palette: { ok: pick('ok'), warn: pick('warn'), critical: pick('critical') },
    colorMode: c.get<string>('colors.mode') === 'gradient' ? 'gradient' : 'bands',
    background: c.get<string>('colors.background', 'none'),
    collapsed: c.get<boolean>('display.collapsed', false),
    glyphs: GLYPHS[glyphs] ? glyphs : 'blocks',
    text: c.get<string>('display.text', 'timeAndPercent'),
    barWidth: c.get<number>('display.barWidth', 5),
    showWeekly: c.get<boolean>('display.showWeekly', true),
    alignment: c.get<string>('display.alignment') === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right,
    staleAfterSec: c.get<number>('staleAfterMinutes', 30) * 60,
    animate: c.get<boolean>('animation.enabled', true) && !reduceMotion,
    sweep: c.get<boolean>('animation.sweep', true),
    spin: c.get<boolean>('animation.spinOnUpdate', true),
    pulse: c.get<string>('animation.pulse', 'critical'),
    alertVisual: c.get<string>('alerts.visual', 'warnAndCritical'),
    alertSound: c.get<string>('alerts.sound', 'criticalOnly'),
    soundFile: c.get<string>('alerts.soundFile', ''),
    volume: c.get<number>('alerts.volume', 0.35),
    statePath: c.get<string>('statePath') || bridge.DEFAULT_STATE_PATH,
  };
}

// ── status bar cells ──────────────────────────────────────────────────────

type Background = 'error' | 'warning' | undefined;

interface Look {
  text: string;
  color?: string;
  background?: Background;
  tooltip?: vscode.MarkdownString;
  command?: string;
}

/** A status bar item that only sends the properties that actually changed. */
class Cell {
  private text = '';
  private color = '';
  private background = '';
  private tooltip?: vscode.MarkdownString;
  private command?: string;
  private visible = false;

  constructor(readonly item: vscode.StatusBarItem) {}

  apply(look: Look): void {
    if (look.text !== this.text) this.item.text = this.text = look.text;
    if ((look.color ?? '') !== this.color) {
      this.item.color = look.color;
      this.color = look.color ?? '';
    }
    if ((look.background ?? '') !== this.background) {
      this.item.backgroundColor = look.background && new vscode.ThemeColor(`statusBarItem.${look.background}Background`);
      this.background = look.background ?? '';
    }
    if (look.tooltip !== this.tooltip) this.item.tooltip = this.tooltip = look.tooltip;
    if (look.command !== this.command) this.item.command = this.command = look.command;
    if (!this.visible) {
      this.item.show();
      this.visible = true;
    }
  }

  hide(): void {
    if (this.visible) this.item.hide();
    this.visible = false;
  }
}

// ── state ─────────────────────────────────────────────────────────────────

interface Motion {
  shown: number; // percent currently drawn
  from: number;
  to: number;
  sweepStart: number;
  spinUntil: number;
  flashUntil: number;
  flashLevel: Level;
}

interface Demo {
  start: number;
  alerted: boolean;
  phase: string;
  message?: vscode.Disposable;
}

let cfg: Cfg;
let memento: vscode.Memento;
let state: QuotaState | undefined;
let history: Sample[] = [];
const views: Partial<Record<WindowKey, WindowView>> = {};
let cells: Partial<Record<WindowKey, Cell>> = {};
let cellsAlignment: vscode.StatusBarAlignment | undefined;
let sharedTooltip: vscode.MarkdownString | undefined;
let tipTurn = Math.floor(Math.random() * 100);
let extensionPath = '';
let focused = true;
let frameTimer: NodeJS.Timeout | undefined;
let demo: Demo | undefined;
const newMotion = (): Motion => ({ shown: 0, from: 0, to: 0, sweepStart: -Infinity, spinUntil: 0, flashUntil: 0, flashLevel: 'ok' });
const motion: Record<WindowKey, Motion> = { session: newMotion(), weekly: newMotion() };
const seen: Partial<Record<WindowKey, number>> = {};

export function activate(context: vscode.ExtensionContext): void {
  extensionPath = context.extensionPath;
  memento = context.globalState;
  history = memento.get<Sample[]>(HISTORY_KEY, []);
  cfg = readConfig();
  focused = vscode.window.state.focused;

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeQuota.toggleCollapsed', toggleCollapsed),
    vscode.commands.registerCommand('claudeQuota.demo', startDemo),
    vscode.commands.registerCommand('claudeQuota.installBridge', installBridge),
    vscode.commands.registerCommand('claudeQuota.uninstallBridge', uninstallBridge),
    vscode.commands.registerCommand('claudeQuota.testAlert', testAlert),
    vscode.commands.registerCommand('claudeQuota.refresh', manualRefresh),
    vscode.commands.registerCommand('claudeQuota.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CFG) || e.affectsConfiguration('workbench.reduceMotion')) {
        cfg = readConfig();
        reload();
      }
    }),
    vscode.window.onDidChangeWindowState((s) => {
      focused = s.focused;
      schedule();
    }),
    { dispose: () => KEYS.forEach((k) => cells[k]?.item.dispose()) },
    { dispose: () => frameTimer && clearTimeout(frameTimer) },
  );

  watchState(context);
  const tick = setInterval(reload, TICK_MS);
  context.subscriptions.push({ dispose: () => clearInterval(tick) });

  syncInstalledCopies();
  pruneAlertMarkers();
  reload();
}

export function deactivate(): void {}

// ── data ──────────────────────────────────────────────────────────────────

function readState(): QuotaState | undefined {
  try {
    return JSON.parse(fs.readFileSync(cfg.statePath, 'utf8')) as QuotaState;
  } catch {
    return undefined;
  }
}

function watchState(context: vscode.ExtensionContext): void {
  // The writers replace the file, so watch the directory, not the file.
  const dir = path.dirname(cfg.statePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
    let debounce: NodeJS.Timeout | undefined;
    const watcher = fs.watch(dir, (_event, file) => {
      if (file && !String(file).startsWith('state.json')) return;
      clearTimeout(debounce);
      debounce = setTimeout(reload, 150);
    });
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch {
    // The 30s tick still picks changes up.
  }
}

function reload(): void {
  state = readState();
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);

  for (const key of KEYS) {
    const v = viewWindow(key, rawFor(state, key), nowSec, cfg.thresholds[key]);
    views[key] = v;

    // A new reading: sweep the bar to it and spin briefly.
    if (v && v.usedPct !== seen[key]) {
      const m = motion[key];
      const first = seen[key] === undefined;
      m.from = first ? 0 : m.shown;
      m.to = v.usedPct;
      m.sweepStart = cfg.animate && cfg.sweep ? now : -Infinity;
      if (!first && cfg.animate && cfg.spin) m.spinUntil = now + SPIN_MS;
      seen[key] = v.usedPct;
    }
  }

  remember(nowSec);
  sharedTooltip = state ? buildTooltip(nowSec) : undefined;
  ensureCells();
  paint();
  for (const v of Object.values(views)) if (v) maybeAlert(v);
}

/** Keeps a history of readings for the burn rates in the hover. */
function remember(nowSec: number): void {
  const s = views.session;
  const w = views.weekly;
  if (!s && !w) return;
  const next = record(history, {
    t: state?.updatedAt ?? nowSec,
    session: s && [s.usedPct, s.resetsAt],
    weekly: w && [w.usedPct, w.resetsAt],
  });
  if (next.length !== history.length) {
    history = next;
    void memento.update(HISTORY_KEY, history);
  }
}

function manualRefresh(): void {
  for (const k of KEYS) motion[k].spinUntil = Date.now() + SPIN_MS;
  reload();
  const age = state ? formatDuration(Date.now() / 1000 - state.updatedAt) : undefined;
  vscode.window.setStatusBarMessage(
    age
      ? `$(info) Claude Quota: newest reading is ${age} old. Claude Code reports usage after each reply.`
      : '$(info) Claude Quota: no reading yet.',
    6000,
  );
}

async function toggleCollapsed(): Promise<void> {
  await vscode.workspace.getConfiguration(CFG).update('display.collapsed', !cfg.collapsed, vscode.ConfigurationTarget.Global);
}

// ── painting ──────────────────────────────────────────────────────────────

function ensureCells(): void {
  if (cellsAlignment === cfg.alignment) return;
  cellsAlignment = cfg.alignment;
  for (const k of KEYS) cells[k]?.item.dispose();
  // Higher priority sits further left, on either side of the status bar.
  const make = (key: WindowKey, priority: number) => {
    const item = vscode.window.createStatusBarItem(`claudeQuota.${key}`, cfg.alignment, priority);
    item.name = `Claude Quota: ${LABEL[key]}`;
    return new Cell(item);
  };
  cells = { session: make('session', 200), weekly: make('weekly', 199.9) };
}

interface Frame {
  views: Partial<Record<WindowKey, WindowView>>;
  collapsed: boolean;
}

/** Draws both limits for the current moment; also the body of each animation frame. */
function paint(): void {
  const now = Date.now();
  const d = demoFrame(now);
  if (!state && !d) {
    paintEmpty();
    return;
  }

  const stale = !d && !!state && now / 1000 - state.updatedAt > cfg.staleAfterSec;
  const collapsed = d ? d.collapsed : cfg.collapsed;
  for (const key of KEYS) {
    const cell = cells[key];
    if (!cell) continue;
    if (key === 'weekly' && !cfg.showWeekly) {
      cell.hide();
      continue;
    }
    const v = d ? d.views[key] : views[key];
    if (!v) {
      paintReset(cell, key);
      continue;
    }
    let pct = v.usedPct;
    if (!d) {
      const m = motion[key];
      const sweepT = (now - m.sweepStart) / SWEEP_MS;
      m.shown = sweepT < 1 ? m.from + (m.to - m.from) * easeOutCubic(sweepT) : m.to;
      pct = m.shown;
    }
    paintCell(cell, v, pct, now, stale, collapsed);
  }
  schedule();
}

function paintCell(cell: Cell, v: WindowView, pct: number, now: number, stale: boolean, collapsed: boolean): void {
  const key = v.key;
  const t = cfg.thresholds[key];
  const level = levelFor(pct, t);
  const m = motion[key];

  const breathe = cfg.animate && focused && pulseFor(level) ? 1 - 0.5 * pulse(now, PULSE_PERIOD_MS) : 1;
  const color = withAlpha(colorAt(pct, t, cfg.palette, cfg.colorMode), (stale ? 0.55 : 1) * breathe);

  let background = backgroundFor(level);
  if (m.flashUntil > now) {
    background = Math.floor((m.flashUntil - now) / FLASH_STEP_MS) % 2 === 0 ? backgroundFor(m.flashLevel, true) : undefined;
  }

  const prefix = m.spinUntil > now ? '$(sync~spin)' : v.runsOutBeforeReset ? '$(flame)' : '';
  const percent = `${Math.round(pct)}%`;
  const parts = collapsed
    ? [prefix, SHORT[key], percent]
    : [
        prefix,
        SHORT[key],
        bar(pct, cfg.barWidth, cfg.glyphs),
        cfg.text !== 'time' ? percent : '',
        cfg.text !== 'percent' ? compactDuration(v.secondsLeft) : '',
      ];
  cell.apply({ text: parts.filter(Boolean).join(' '), color, background, tooltip: sharedTooltip, command: 'claudeQuota.toggleCollapsed' });
}

function paintReset(cell: Cell, key: WindowKey): void {
  cell.apply({
    text: `${SHORT[key]} reset`,
    color: withAlpha(cfg.palette.ok, 0.8),
    tooltip: sharedTooltip,
    command: 'claudeQuota.toggleCollapsed',
  });
}

function paintEmpty(): void {
  cells.weekly?.hide();
  const installed = bridge.isInstalled();
  cells.session?.apply({
    text: '$(watch) Claude quota —',
    command: installed ? 'claudeQuota.demo' : 'claudeQuota.installBridge',
    tooltip: md(
      installed
        ? 'Waiting for usage data. It appears after your next Claude Code reply (Pro and Max plans only). Chat sessions started before connecting do not report it.\n\n**Click to play the demo.**'
        : 'No usage data yet. **Click to connect to Claude Code**, so it reports your session and weekly usage here.\n\n[Play the demo](command:claudeQuota.demo)',
    ),
  });
}

function pulseFor(level: Level): boolean {
  if (cfg.pulse === 'off' || level === 'ok') return false;
  return cfg.pulse === 'warnAndCritical' || level === 'critical';
}

function backgroundFor(level: Level, force = false): Background {
  const mode = force ? 'warnAndCritical' : cfg.background;
  if (level === 'critical' && mode !== 'none') return 'error';
  if (level === 'warn' && mode === 'warnAndCritical') return 'warning';
  return undefined;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * One timer, and only while something moves: fast frames for a sweep, a flash,
 * a spin or the demo, slow ones for the pulse, and none at all while VS Code
 * is in the background or nothing moves.
 */
function schedule(): void {
  if (frameTimer) return;
  const now = Date.now();
  const busy =
    !!demo ||
    KEYS.some((k) => {
      const m = motion[k];
      return now - m.sweepStart < SWEEP_MS || m.flashUntil > now || m.spinUntil > now;
    });
  const breathing =
    cfg.animate && focused && KEYS.some((k) => views[k] && pulseFor(levelFor(motion[k].shown, cfg.thresholds[k])));
  if (!busy && !breathing) return;
  frameTimer = setTimeout(
    () => {
      frameTimer = undefined;
      paint();
    },
    busy ? FAST_FRAME_MS : PULSE_FRAME_MS,
  );
}

// ── demo ──────────────────────────────────────────────────────────────────

function startDemo(): void {
  demo?.message?.dispose();
  demo = { start: Date.now(), alerted: false, phase: '' };
  ensureCells();
  paint();
}

/**
 * The demo's moment: both limits fill (the 5-hour one through green, yellow
 * and red, with its alert), then the compact view, then back to real data.
 */
function demoFrame(now: number): Frame | undefined {
  if (!demo) return undefined;
  const t = (now - demo.start) / DEMO_MS;
  if (t >= 1) {
    demo.message?.dispose();
    demo = undefined;
    vscode.window.setStatusBarMessage('$(check) Claude Quota demo finished. Click the meter any time to switch views.', 4000);
    reload();
    return undefined;
  }

  const fill = easeInOut(Math.min(1, t / 0.7));
  const nowSec = now / 1000;
  // The flame shows only late in the 5-hour fill, where a real pace would run out.
  const fake = (key: WindowKey, pct: number, left: number): WindowView | undefined => {
    const v = viewWindow(key, { used_percentage: pct, resets_at: nowSec + left }, nowSec, cfg.thresholds[key]);
    return v && { ...v, runsOutBeforeReset: key === 'session' && fill > 0.8 };
  };
  const frame: Frame = {
    views: {
      session: fake('session', 100 * fill, 5 * 3600 * (1 - 0.85 * fill)),
      weekly: fake('weekly', 72 * fill, 7 * 86400 * (1 - 0.4 * fill)),
    },
    collapsed: t >= 0.78 ? !cfg.collapsed : cfg.collapsed,
  };

  const s = frame.views.session!;
  const th = cfg.thresholds.session;
  const level = levelFor(s.usedPct, th);
  const phase = t >= 0.78 ? 'toggle' : level;
  if (phase !== demo.phase) {
    demo.phase = phase;
    const text: Record<string, string> = {
      ok: `$(play) Demo: green while under ${th.warnAt}%`,
      warn: `$(play) Demo: yellow from ${th.warnAt}%`,
      critical: `$(play) Demo: red from ${th.criticalAt}%, with your alert`,
      toggle: `$(play) Demo: ${cfg.collapsed ? 'full' : 'compact'} view. Click the meter to switch views`,
    };
    demo.message?.dispose();
    demo.message = vscode.window.setStatusBarMessage(text[phase], 4000);
  }
  if (level === 'critical' && !demo.alerted) {
    demo.alerted = true;
    fire(s, 'critical', 'Demo: ');
  }
  return frame;
}

// ── tooltip ───────────────────────────────────────────────────────────────

function swatch(color: string, text: string): string {
  return `<span style="color:${color};">${text}</span>`;
}

function colorBar(pct: number, t: Thresholds, width = 10): string {
  const [full, empty] = GLYPHS.blocks;
  return segments(pct, width)
    .map((s) => swatch(withAlpha(colorAt(s.at, t, cfg.palette, cfg.colorMode), s.lit ? 1 : 0.3), s.lit ? full : empty))
    .join('');
}

const num = (n: number) => (n < 10 ? n.toFixed(1) : String(Math.round(n)));
const tokens = (n: number) => (n >= 1_000_000 ? `${num(n / 1_000_000)}M` : `${Math.round(n / 1000)}k`);

function resetWhen(v: WindowView): string {
  const at = new Date(v.resetsAt * 1000);
  return v.key === 'session'
    ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleString([], { weekday: 'short', hour: 'numeric' });
}

function pace(v: WindowView): string {
  const diff = Math.round(v.usedPct - v.elapsed * 100);
  if (Math.abs(diff) < 5) return 'even pace';
  return diff > 0 ? `**${diff} pts ahead**` : `${-diff} pts under`;
}

function outlook(v: WindowView): string {
  if (v.secondsToFull === 0) return '**limit reached**';
  if (v.secondsToFull === null) return 'no use yet';
  return v.runsOutBeforeReset ? `$(flame) **full in ${compactDuration(v.secondsToFull)}**` : '$(check) lasts to reset';
}

function buildTooltip(nowSec: number): vscode.MarkdownString {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const col = (key: WindowKey, row: (v: WindowView) => string) => {
    const v = views[key];
    return v ? row(v) : '—';
  };
  const burn = (v: WindowView) => {
    const r = rates(history, v, nowSec, midnight.getTime() / 1000);
    const since = r.recentFrom
      ? `since ${new Date(r.recentFrom * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : undefined;
    if (v.key === 'session') {
      const recent = r.recent === undefined ? '' : `${num(r.recent)}%/h ${since ?? 'last hour'} · `;
      return `${recent}${num(r.average)}%/h avg`;
    }
    const today = r.recent === undefined ? '' : `+${num(r.recent)}% ${since ?? 'today'} · `;
    return `${today}${num(r.average)}%/day avg`;
  };
  const room = (v: WindowView) => {
    const r = rates(history, v, nowSec, midnight.getTime() / 1000);
    return v.key === 'session' ? `${num(r.room)}%/h to last` : `${num(r.room)}%/day to last`;
  };
  const used = (v: WindowView) => {
    const t = cfg.thresholds[v.key];
    return `${colorBar(v.usedPct, t)} ${swatch(colorAt(v.usedPct, t, cfg.palette, cfg.colorMode), `**${Math.round(v.usedPct)}%**`)}`;
  };

  const showWeekly = cfg.showWeekly;
  const row = (label: string, f: (v: WindowView) => string) =>
    `| ${label} | ${col('session', f)} |${showWeekly ? ` ${col('weekly', f)} |` : ''}`;
  const age = state ? formatDuration(nowSec - state.updatedAt) : '?';

  const lines = [
    `**Claude usage** · reading ${age} old`,
    '',
    showWeekly ? '| | **5-hour** | **Weekly** |' : '| | **5-hour** |',
    showWeekly ? '|:--|:--|:--|' : '|:--|:--|',
    row('Used', used),
    row('Resets', (v) => `in ${compactDuration(v.secondsLeft)} · ${resetWhen(v)}`),
    row('Pace', pace),
    row('Burn', burn),
    row('Room', room),
    row('Outlook', outlook),
  ];

  const s = state?.session;
  if (s) {
    const bits = [
      s.model,
      s.contextPercent !== undefined
        ? `context ${Math.round(s.contextPercent)}%${s.contextTokens && s.contextWindow ? ` (${tokens(s.contextTokens)} of ${tokens(s.contextWindow)})` : ''}`
        : undefined,
      s.costUsd !== undefined ? `≈ $${s.costUsd.toFixed(2)} at API prices` : undefined,
      s.cacheHitRatio !== undefined ? `cache hits ${Math.round(s.cacheHitRatio * 100)}%` : undefined,
    ].filter(Boolean);
    if (bits.length) lines.push('', `**Last conversation** · ${bits.join(' · ')}`);
  }

  const sv = views.session;
  const tip = pickTip(
    {
      sessionLevel: sv && levelFor(sv.usedPct, cfg.thresholds.session),
      weeklyLevel: views.weekly && levelFor(views.weekly.usedPct, cfg.thresholds.weekly),
      sessionRunsOut: sv?.runsOutBeforeReset,
      sessionResetsIn: sv && compactDuration(sv.secondsLeft),
      contextPercent: s?.contextPercent,
      cacheHitRatio: s?.cacheHitRatio,
    },
    tipTurn++,
  );
  lines.push(
    '',
    `$(lightbulb) **Tip:** ${tip}`,
    '',
    '---',
    `[${cfg.collapsed ? 'Expand' : 'Collapse'}](command:claudeQuota.toggleCollapsed) · [Play demo](command:claudeQuota.demo) · [Preview alert](command:claudeQuota.testAlert) · [Settings](command:claudeQuota.openSettings)`,
  );
  return md(lines.join('\n'));
}

function md(text: string): vscode.MarkdownString {
  const m = new vscode.MarkdownString(text, true);
  m.supportHtml = true;
  m.isTrusted = {
    enabledCommands: [
      'claudeQuota.toggleCollapsed',
      'claudeQuota.demo',
      'claudeQuota.testAlert',
      'claudeQuota.openSettings',
      'claudeQuota.refresh',
      'claudeQuota.installBridge',
    ],
  };
  return m;
}

// ── alerts ────────────────────────────────────────────────────────────────

function markerDir(): string {
  return path.join(path.dirname(cfg.statePath), 'alerts');
}

/**
 * Claim an alert across every open VS Code window: creating the marker file
 * with 'wx' succeeds in exactly one process, so one alert sounds, not one per window.
 */
function claim(key: string): boolean {
  try {
    fs.mkdirSync(markerDir(), { recursive: true });
    fs.closeSync(fs.openSync(path.join(markerDir(), key), 'wx'));
    return true;
  } catch {
    return false;
  }
}

function firedKeys(): Set<string> {
  try {
    return new Set(fs.readdirSync(markerDir()));
  } catch {
    return new Set();
  }
}

function pruneAlertMarkers(): void {
  const cutoff = Date.now() - 8 * 86400 * 1000;
  try {
    for (const f of fs.readdirSync(markerDir())) {
      const p = path.join(markerDir(), f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    }
  } catch {
    // nothing to prune
  }
}

function maybeAlert(v: WindowView): void {
  const level = pendingAlert(v, firedKeys());
  if (!level || !claim(alertKey(v, level))) return;
  if (level === 'critical') claim(alertKey(v, 'warn')); // never warn after critical
  fire(v, level);
}

function fire(v: WindowView, level: Level, prefix = ''): void {
  if (shouldNotify(cfg.alertSound, level)) playSound(cfg.soundFile, cfg.volume);
  if (!shouldNotify(cfg.alertVisual, level)) return;

  flash(v.key, level);
  const name = v.key === 'session' ? 'session' : 'weekly';
  const pace =
    v.runsOutBeforeReset && v.secondsToFull ? ` At this pace you will hit the limit in ${formatDuration(v.secondsToFull)}.` : '';
  const msg = `${prefix}Claude ${name} usage is at ${Math.round(v.usedPct)}%. It resets in ${formatDuration(v.secondsLeft)}.${pace}`;
  const show = level === 'critical' ? vscode.window.showErrorMessage : vscode.window.showWarningMessage;
  show(msg, 'Settings').then((pick) => pick && vscode.commands.executeCommand('claudeQuota.openSettings'));
}

function flash(key: WindowKey, level: Level): void {
  motion[key].flashUntil = Date.now() + FLASH_MS;
  motion[key].flashLevel = level;
  paint();
}

async function testAlert(): Promise<void> {
  playSound(cfg.soundFile, cfg.volume);
  flash('session', 'critical');
  await vscode.window.showErrorMessage(
    `Preview: Claude session usage is at ${cfg.thresholds.session.criticalAt}%. It resets in 1h 48m. At this pace you will hit the limit in 40m.`,
  );
}

// ── connecting to Claude Code ─────────────────────────────────────────────

const bundledBridge = () => path.join(extensionPath, 'bridge', 'quota-bridge.js');
const bundledMod = () => path.join(extensionPath, 'mod', 'quota-bar');

/** After an extension update, refresh the installed bridge and plugin in place. */
function syncInstalledCopies(): void {
  try {
    if (bridge.isInstalled()) bridge.sync(bundledBridge(), bundledMod());
  } catch {
    // keep the copies already installed
  }
}

async function installBridge(): Promise<void> {
  let existing: string | undefined;
  try {
    existing = bridge.currentStatusLine()?.command;
  } catch (e) {
    vscode.window.showErrorMessage(`Could not read ~/.claude/settings.json: ${(e as Error).message}`);
    return;
  }
  if (bridge.isInstalled()) {
    vscode.window.showInformationMessage('Already connected to Claude Code.');
    return;
  }

  const terminal = existing
    ? `Terminal: statusLine runs a small script that saves your usage. Your current status line (${existing}) is kept and still prints.`
    : 'Terminal: statusLine runs a small script that saves your usage and prints a short usage line.';
  const detail = [
    'This edits ~/.claude/settings.json (a backup is saved as settings.json.bak-quota-bar):',
    '',
    terminal,
    'Chat panel: adds the quota-bar plugin to CLAUDE_CODE_PLUGIN_DIRS. It saves your usage after each reply, starting with your next new chat, and lets you change these settings by asking Claude.',
  ].join('\n');
  const ok = await vscode.window.showInformationMessage('Connect Claude Quota Bar to Claude Code?', { modal: true, detail }, 'Connect');
  if (ok !== 'Connect') return;

  try {
    const msg = bridge.install(bundledBridge(), bundledMod());
    vscode.window.showInformationMessage(`${msg} Usage appears after your next Claude Code reply.`);
    reload();
  } catch (e) {
    vscode.window.showErrorMessage(`Connect failed: ${(e as Error).message}`);
  }
}

async function uninstallBridge(): Promise<void> {
  try {
    vscode.window.showInformationMessage(bridge.uninstall());
  } catch (e) {
    vscode.window.showErrorMessage(`Disconnect failed: ${(e as Error).message}`);
  }
}
