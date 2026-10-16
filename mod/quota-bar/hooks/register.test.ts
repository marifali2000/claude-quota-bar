import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const NOW_MS = 1_800_000_000_000
const NOW = NOW_MS / 1000
const iso = (sec: number) => new Date(sec * 1000).toISOString()
const context = { window: 200_000 }

function world(on: On, existing?: string) {
  mock.env(on, { HOME: '/home/t' })
  mock.clock(on, { now: NOW_MS })
  const writes: { path: string; text: string }[] = []
  on('fs.read', () => (existing === undefined ? { deny: 'ENOENT' } : { value: existing }))
  on('fs.write', ($, e) => {
    writes.push(e)
    return { value: undefined }
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  return writes
}

test('a measurement writes both windows to the state file', async ($, on) => {
  const writes = world(on)
  await $.session.measure({
    context,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 62.4, resetsAt: iso(NOW + 6480) },
      { kind: 'seven_day', percentUsed: 41.2, resetsAt: iso(NOW + 3 * 86400) },
    ],
    changed: ['rateLimits'],
  })

  expect(writes.length).toBe(1)
  expect(writes[0]!.path).toBe('/home/t/.claude/quota-bar/state.json')
  const state = JSON.parse(writes[0]!.text)
  expect(state.updatedAt).toBe(NOW)
  expect(state.rate_limits.five_hour).toEqual({ used_percentage: 62.4, resets_at: NOW + 6480 })
  expect(state.rate_limits.seven_day).toEqual({ used_percentage: 41.2, resets_at: NOW + 3 * 86400 })
})

test('a measurement saves the replying session context and cost', async ($, on) => {
  const writes = world(on)
  await $.session.measure({
    context: { window: 200_000, tokens: 90_000, percent: 45 },
    cost: { usd: 1.25 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 10, resetsAt: iso(NOW + 3600) }],
    changed: ['rateLimits', 'context'],
  })
  const { session } = JSON.parse(writes[0]!.text)
  expect(session.contextPercent).toBe(45)
  expect(session.contextTokens).toBe(90_000)
  expect(session.contextWindow).toBe(200_000)
  expect(session.costUsd).toBe(1.25)
})

test('a reading with one window keeps the other until it resets', async ($, on) => {
  const previous = JSON.stringify({
    version: 1,
    updatedAt: NOW - 60,
    rate_limits: {
      five_hour: { used_percentage: 50, resets_at: NOW + 3600 },
      seven_day: { used_percentage: 99, resets_at: NOW - 1 },
    },
  })
  const writes = world(on, previous)
  await $.session.measure({
    context,
    rateLimits: [{ kind: 'seven_day', percentUsed: 3, resetsAt: iso(NOW + 7 * 86400) }],
    changed: ['rateLimits'],
  })

  const state = JSON.parse(writes[0]!.text)
  expect(state.rate_limits.five_hour).toEqual({ used_percentage: 50, resets_at: NOW + 3600 })
  expect(state.rate_limits.seven_day.used_percentage).toBe(3)
})

test('no subscription windows, no write', async ($, on) => {
  const writes = world(on)
  await $.session.measure({
    context,
    rateLimits: [{ kind: 'spend_limit', percentUsed: 10, resetsAt: iso(NOW + 86400) }],
    changed: ['rateLimits'],
  })
  expect(writes.length).toBe(0)
})
