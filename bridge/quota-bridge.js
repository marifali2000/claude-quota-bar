#!/usr/bin/env node
// Claude Code status line bridge for Claude Quota Bar.
//
// Claude Code pipes session JSON to the status line command on stdin. This
// script saves the `rate_limits` part to ~/.claude/quota-bar/state.json, where
// the VS Code extension picks it up, then prints a status line. If you had a
// status line before installing, its command is kept in ~/.claude/quota-bar/chain
// and its output is printed instead, so your terminal status line is unchanged.
//
// No network, no credentials: it only reads what Claude Code already hands it.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = process.env.CLAUDE_QUOTA_BAR_DIR || path.join(os.homedir(), '.claude', 'quota-bar');
const STATE = path.join(DIR, 'state.json');
const CHAIN = path.join(DIR, 'chain');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function isWindow(w) {
  return w && typeof w.used_percentage === 'number' && typeof w.resets_at === 'number';
}

// Claude Code sends rate_limits only after the first API response, and drops a
// window once it resets. Merge with what we last saw so a response that carries
// one window does not erase the other, but never keep a window past its reset.
function merge(previous, incoming, nowSec) {
  const out = {};
  for (const key of ['five_hour', 'seven_day']) {
    const next = incoming && incoming[key];
    const prev = previous && previous[key];
    if (isWindow(next)) out[key] = { used_percentage: next.used_percentage, resets_at: next.resets_at };
    else if (isWindow(prev) && prev.resets_at > nowSec) out[key] = prev;
  }
  return out;
}

function save(input) {
  const incoming = input && input.rate_limits;
  if (!incoming || (!isWindow(incoming.five_hour) && !isWindow(incoming.seven_day))) return undefined;

  const nowSec = Math.floor(Date.now() / 1000);
  const previous = readJson(STATE);
  const ctx = input.context_window || {};
  const state = {
    version: 1,
    updatedAt: nowSec,
    sessionId: input.session_id,
    // The session that just replied, for the extension's hover.
    session: {
      id: input.session_id,
      model: input.model && input.model.display_name,
      contextPercent: ctx.used_percentage == null ? undefined : ctx.used_percentage,
      contextTokens: ctx.total_input_tokens,
      contextWindow: ctx.context_window_size,
      costUsd: input.cost && input.cost.total_cost_usd,
      cacheHitRatio: input.prompt_cache && input.prompt_cache.hit_ratio,
    },
    rate_limits: merge(previous && previous.rate_limits, incoming, nowSec),
  };

  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${STATE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE); // atomic, so the extension never reads half a file
  return state;
}

function fmtLeft(resetsAt) {
  const s = Math.max(0, resetsAt - Math.floor(Date.now() / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

function defaultLine(input, state) {
  const parts = [];
  if (input && input.model && input.model.display_name) parts.push(input.model.display_name);
  const rl = state && state.rate_limits;
  if (rl && rl.five_hour) parts.push(`5h ${Math.round(rl.five_hour.used_percentage)}% (${fmtLeft(rl.five_hour.resets_at)})`);
  if (rl && rl.seven_day) parts.push(`7d ${Math.round(rl.seven_day.used_percentage)}% (${fmtLeft(rl.seven_day.resets_at)})`);
  return parts.join(' · ');
}

function main() {
  const raw = readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    input = undefined;
  }

  let state;
  try {
    state = save(input) || readJson(STATE);
  } catch {
    state = readJson(STATE);
  }

  let chain = '';
  try {
    chain = fs.readFileSync(CHAIN, 'utf8').trim();
  } catch {
    // no previous status line
  }

  if (chain) {
    const r = spawnSync(chain, { input: raw, shell: true, encoding: 'utf8', timeout: 5000 });
    process.stdout.write(r.stdout || '');
    return;
  }
  process.stdout.write(defaultLine(input, state));
}

main();
