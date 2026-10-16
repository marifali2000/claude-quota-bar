import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Connects Claude Code to the extension in two ways, both writing the same
// ~/.claude/quota-bar/state.json:
// - the terminal CLI: the bridge script as Claude Code's status line, keeping any
//   existing status line command so the terminal output does not change;
// - the VS Code chat panel, which never runs the status line: the quota-bar mod,
//   loaded through CLAUDE_CODE_PLUGIN_DIRS.

export const QUOTA_DIR = path.join(os.homedir(), '.claude', 'quota-bar');
export const DEFAULT_STATE_PATH = path.join(QUOTA_DIR, 'state.json');
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const BRIDGE = path.join(QUOTA_DIR, 'quota-bridge.js');
const CHAIN = path.join(QUOTA_DIR, 'chain');
const MOD = path.join(QUOTA_DIR, 'mod');
const MARKER = 'quota-bar/quota-bridge.js';
const PLUGIN_DIRS = 'CLAUDE_CODE_PLUGIN_DIRS';

interface StatusLine {
  type?: string;
  command?: string;
  [k: string]: unknown;
}

type Settings = Record<string, unknown> & { statusLine?: StatusLine; env?: Record<string, string> };

function readSettings(): Settings {
  if (!fs.existsSync(SETTINGS)) return {};
  // Throws on malformed JSON: better to refuse than to overwrite the file.
  return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
}

function writeSettings(settings: Settings): void {
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, `${SETTINGS}.bak-quota-bar`);
  const tmp = `${SETTINGS}.quota-bar.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmp, SETTINGS);
}

function pluginDirs(settings: Settings): string[] {
  return (settings.env?.[PLUGIN_DIRS] ?? '').split(path.delimiter).filter(Boolean);
}

export function isInstalled(): boolean {
  try {
    const settings = readSettings();
    return !!settings.statusLine?.command?.includes(MARKER) && pluginDirs(settings).includes(MOD);
  } catch {
    return false;
  }
}

export function currentStatusLine(): StatusLine | undefined {
  return readSettings().statusLine;
}

const skipTests = (src: string) => !src.endsWith('.test.ts');

function copyBridgeAndMod(bundledBridge: string, bundledMod: string): void {
  fs.mkdirSync(QUOTA_DIR, { recursive: true });
  fs.copyFileSync(bundledBridge, BRIDGE);
  fs.chmodSync(BRIDGE, 0o755);
  fs.rmSync(MOD, { recursive: true, force: true });
  fs.cpSync(bundledMod, MOD, { recursive: true, filter: skipTests });
}

/** True when every bundled file has an identical installed copy; extra installed files are ignored. */
function sameTree(bundled: string, installed: string): boolean {
  try {
    if (fs.statSync(bundled).isDirectory()) {
      return fs
        .readdirSync(bundled)
        .filter(skipTests)
        .every((n) => sameTree(path.join(bundled, n), path.join(installed, n)));
    }
    return fs.readFileSync(bundled).equals(fs.readFileSync(installed));
  } catch {
    return false;
  }
}

/** Refreshes the installed copies when the bundled ones differ, as after an extension update. */
export function sync(bundledBridge: string, bundledMod: string): boolean {
  if (sameTree(bundledBridge, BRIDGE) && sameTree(bundledMod, MOD)) return false;
  copyBridgeAndMod(bundledBridge, bundledMod);
  return true;
}

/** Returns a description of what changed. */
export function install(bundledBridge: string, bundledMod: string): string {
  const settings = readSettings();
  const existing = settings.statusLine;

  copyBridgeAndMod(bundledBridge, bundledMod);

  let chained = '';
  if (existing?.command && !existing.command.includes(MARKER)) {
    fs.writeFileSync(CHAIN, existing.command + '\n');
    chained = existing.command;
  }
  settings.statusLine = { ...(existing ?? {}), type: 'command', command: `node "${BRIDGE}"` };

  const dirs = pluginDirs(settings);
  if (!dirs.includes(MOD)) settings.env = { ...(settings.env ?? {}), [PLUGIN_DIRS]: [...dirs, MOD].join(path.delimiter) };
  writeSettings(settings);

  const terminal = chained
    ? `Your previous status line (${chained}) still prints in the terminal.`
    : 'The terminal status line now shows your usage.';
  return `Connected. ${terminal} New chat panel sessions report usage too.`;
}

export function uninstall(): string {
  const settings = readSettings();
  const changed: string[] = [];

  if (settings.statusLine?.command?.includes(MARKER)) {
    let previous = '';
    try {
      previous = fs.readFileSync(CHAIN, 'utf8').trim();
    } catch {
      // there was no previous status line
    }
    if (previous) settings.statusLine = { ...settings.statusLine, command: previous };
    else delete settings.statusLine;
    fs.rmSync(CHAIN, { force: true });
    changed.push(previous ? `restored your status line (${previous})` : 'removed the status line');
  }

  const dirs = pluginDirs(settings);
  if (dirs.includes(MOD) && settings.env) {
    const rest = dirs.filter((d) => d !== MOD);
    if (rest.length) settings.env[PLUGIN_DIRS] = rest.join(path.delimiter);
    else delete settings.env[PLUGIN_DIRS];
    changed.push('removed the chat panel mod');
  }

  if (!changed.length) return 'Not connected; nothing changed.';
  writeSettings(settings);
  fs.rmSync(MOD, { recursive: true, force: true });
  return `Disconnected: ${changed.join(' and ')}.`;
}
