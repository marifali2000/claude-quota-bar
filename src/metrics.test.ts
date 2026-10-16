import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Sample, growth, rates, record, valueAt } from './metrics';
import { viewWindow } from './quota';

const T = { warnAt: 60, criticalAt: 90 };
const NOW = 1_800_000_000;
const RESET = NOW + 2 * 3600; // 5h window that began 3h ago
const session = (pct: number) => viewWindow('session', { used_percentage: pct, resets_at: RESET }, NOW, T)!;

test('record keeps only changes', () => {
  let h: Sample[] = [];
  h = record(h, { t: NOW - 100, session: [10, RESET] });
  h = record(h, { t: NOW - 50, session: [10, RESET] });
  h = record(h, { t: NOW, session: [12, RESET] });
  assert.equal(h.length, 2);
});

test('record drops samples older than eight days', () => {
  const h = record([{ t: NOW - 9 * 86400, session: [1, RESET] }], { t: NOW, session: [2, RESET] });
  assert.deepEqual(h.map((s) => s.t), [NOW]);
});

test('valueAt finds the value held at a moment, within the same window', () => {
  const h: Sample[] = [
    { t: NOW - 7200, session: [5, RESET] },
    { t: NOW - 3000, session: [20, RESET] },
    { t: NOW - 600, session: [30, RESET] },
  ];
  assert.deepEqual(valueAt(h, 'session', NOW - 3600, RESET), { value: 5, t: NOW - 3600 });
  assert.equal(valueAt(h, 'session', NOW - 3600, RESET + 5 * 3600), undefined, 'another window');
  assert.deepEqual(valueAt(h.slice(1), 'session', NOW - 3600, RESET), { value: 20, t: NOW - 3000 });
});

test('growth over the last hour, and from an empty window start', () => {
  const h: Sample[] = [{ t: NOW - 7200, session: [5, RESET] }];
  assert.deepEqual(growth(h, session(35), NOW - 3600, NOW), { delta: 30, spanSec: 3600, fromSec: NOW - 3600 });
  // asking from before the window began counts from 0 at its start, 3h ago
  assert.deepEqual(growth(h, session(35), NOW - 5 * 3600, NOW), { delta: 35, spanSec: 3 * 3600, fromSec: NOW - 3 * 3600 });
});

test('session rates: average, last hour, room left', () => {
  const h: Sample[] = [{ t: NOW - 7200, session: [5, RESET] }];
  const r = rates(h, session(36), NOW, NOW - 10 * 3600);
  assert.equal(r.average, 12); // 36% over 3h
  assert.equal(r.recent, 31); // 5 → 36 in the last hour
  assert.equal(r.room, 32); // 64% left over 2h
});

test('weekly rates: today since midnight, per-day average and room', () => {
  const reset = NOW + 4 * 86400; // began 3 days ago
  const v = viewWindow('weekly', { used_percentage: 45, resets_at: reset }, NOW, T)!;
  const midnight = NOW - 5 * 3600;
  const h: Sample[] = [{ t: midnight - 600, weekly: [38, reset] }];
  const r = rates(h, v, NOW, midnight);
  assert.equal(r.average, 15);
  assert.equal(r.recent, 7);
  assert.equal(r.room, 13.75);
});

test('no recent rate from a few minutes of history; a later start is reported', () => {
  const reset = NOW + 4 * 86400;
  const v = viewWindow('weekly', { used_percentage: 45, resets_at: reset }, NOW, T)!;
  const midnight = NOW - 5 * 3600;
  assert.equal(rates([{ t: NOW - 120, weekly: [45, reset] }], v, NOW, midnight).recent, undefined);
  const r = rates([{ t: NOW - 7200, weekly: [40, reset] }], v, NOW, midnight);
  assert.equal(r.recent, 5);
  assert.equal(r.recentFrom, NOW - 7200);
});
