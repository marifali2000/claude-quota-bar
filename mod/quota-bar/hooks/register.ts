import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

// Saves the account's rate-limit windows to ~/.claude/quota-bar/state.json, the
// file the Claude Quota Bar VS Code extension watches. Same format as
// bridge/quota-bridge.js, but this runs inside the engine, so it also works in
// the VS Code chat panel, which never runs the status line command.

type Window = { used_percentage: number; resets_at: number }
type Windows = { five_hour?: Window; seven_day?: Window }
type Session = {
  id?: string
  model?: string
  contextPercent?: number
  contextTokens?: number
  contextWindow?: number
  costUsd?: number
}
type State = { version: 1; updatedAt: number; sessionId?: string; session?: Session; rate_limits: Windows }

const KINDS = ['five_hour', 'seven_day'] as const

export function toWindows(limits: readonly SessionRateLimit[]): Windows {
  const out: Windows = {}
  for (const l of limits) {
    if (!(KINDS as readonly string[]).includes(l.kind) || !l.resetsAt) continue
    const resetsAt = Math.floor(Date.parse(l.resetsAt) / 1000)
    if (Number.isFinite(resetsAt)) out[l.kind as (typeof KINDS)[number]] = { used_percentage: l.percentUsed, resets_at: resetsAt }
  }
  return out
}

// A reading may carry one window; keep the other until it resets.
export function merge(previous: Windows | undefined, incoming: Windows, nowSec: number): Windows {
  const out: Windows = {}
  for (const k of KINDS) {
    const prev = previous?.[k]
    if (incoming[k]) out[k] = incoming[k]
    else if (prev && prev.resets_at > nowSec) out[k] = prev
  }
  return out
}

async function statePath($: EngineInterface): Promise<string | undefined> {
  const dir = await $.env.get('CLAUDE_QUOTA_BAR_DIR')
  if (dir) return `${dir}/state.json`
  const home = await $.env.get('HOME')
  return home ? `${home}/.claude/quota-bar/state.json` : undefined
}

// The session that just replied: how full its context is and what it has cost,
// shown in the extension's hover next to the limits.
async function sessionStats($: EngineInterface, context?: SessionContextUsage, cost?: SessionCost): Promise<Session> {
  return {
    id: await $.session.id().catch(() => undefined),
    model: await $.session.model().catch(() => undefined),
    contextPercent: context?.percent,
    contextTokens: context?.tokens,
    contextWindow: context?.window,
    costUsd: cost?.usd,
  }
}

async function save(
  $: EngineInterface,
  limits: readonly SessionRateLimit[],
  context?: SessionContextUsage,
  cost?: SessionCost,
): Promise<void> {
  const incoming = toWindows(limits)
  if (!incoming.five_hour && !incoming.seven_day) return
  const path = await statePath($)
  if (!path) return

  const previous = await $.fs
    .read(path)
    .then(text => (JSON.parse(text) as State).rate_limits)
    .catch(() => undefined)
  const nowSec = Math.floor((await $.clock.now()) / 1000)
  const session = await sessionStats($, context, cost)
  const state: State = {
    version: 1,
    updatedAt: nowSec,
    sessionId: session.id,
    session,
    rate_limits: merge(previous, incoming, nowSec),
  }
  await $.fs.write(path, JSON.stringify(state, null, 2))
}

export const register: Register = on => {
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    // Write on every measurement, not only when a window moved a point, so the
    // extension's "last updated" stays fresh while you work.
    await save($, e.rateLimits, e.context, e.cost).catch(err => $.ui.log(`quota-bar: ${String(err)}`, { to: 'debug' }))
    return result
  })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const usage = await $.session.usage()
    await save($, usage.rateLimits, usage.context, usage.cost).catch(() => undefined)
    return result
  })
}
