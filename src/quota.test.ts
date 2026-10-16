import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  PALETTES,
  alertKey,
  bar,
  colorAt,
  easeOutCubic,
  formatDuration,
  isHex,
  mix,
  pendingAlert,
  pulse,
  segments,
  shouldNotify,
  viewWindow,
  withAlpha,
} from './quota';

const T = { warnAt: 80, criticalAt: 95 };
const NOW = 1_800_000_000;

test('session window: time left, elapsed fraction and level', () => {
  // 2h left of 5h → 3h elapsed
  const v = viewWindow('session', { used_percentage: 60, resets_at: NOW + 7200 }, NOW, T)!;
  assert.equal(v.secondsLeft, 7200);
  assert.equal(v.elapsed, 0.6);
  assert.equal(v.level, 'ok');
  // 60% in 3h → 40% more takes 2h, exactly at reset: does not run out first
  assert.equal(v.secondsToFull, 7200);
  assert.equal(v.runsOutBeforeReset, false);
});

test('flags a pace that runs out before the reset', () => {
  // 50% used in the first hour, 4h left → full in 1h
  const v = viewWindow('session', { used_percentage: 50, resets_at: NOW + 4 * 3600 }, NOW, T)!;
  assert.equal(v.secondsToFull, 3600);
  assert.equal(v.runsOutBeforeReset, true);
});

test('a window past its reset is not shown', () => {
  assert.equal(viewWindow('weekly', { used_percentage: 99, resets_at: NOW - 1 }, NOW, T), undefined);
  assert.equal(viewWindow('weekly', undefined, NOW, T), undefined);
});

test('levels follow the thresholds', () => {
  const at = (p: number) => viewWindow('weekly', { used_percentage: p, resets_at: NOW + 86400 }, NOW, T)!.level;
  assert.equal(at(79.9), 'ok');
  assert.equal(at(80), 'warn');
  assert.equal(at(95), 'critical');
});

test('each threshold alerts once per window instance', () => {
  const v = viewWindow('session', { used_percentage: 85, resets_at: NOW + 3600 }, NOW, T)!;
  const fired = new Set<string>();
  assert.equal(pendingAlert(v, fired), 'warn');
  fired.add(alertKey(v, 'warn'));
  assert.equal(pendingAlert(v, fired), undefined);

  const next = viewWindow('session', { used_percentage: 85, resets_at: NOW + 5 * 3600 + 60 }, NOW + 60, T)!;
  assert.equal(pendingAlert(next, fired), 'warn', 'a new window alerts again');
});

test('a warn reading after critical already fired stays quiet', () => {
  const v = viewWindow('session', { used_percentage: 85, resets_at: NOW + 3600 }, NOW, T)!;
  assert.equal(pendingAlert(v, new Set([alertKey(v, 'critical')])), undefined);
});

test('notify modes', () => {
  assert.equal(shouldNotify('warnAndCritical', 'warn'), true);
  assert.equal(shouldNotify('criticalOnly', 'warn'), false);
  assert.equal(shouldNotify('criticalOnly', 'critical'), true);
  assert.equal(shouldNotify('off', 'critical'), false);
});

test('formatting', () => {
  assert.equal(formatDuration(3 * 86400 + 4 * 3600 + 59), '3d 4h');
  assert.equal(formatDuration(6480), '1h 48m');
  assert.equal(formatDuration(7200), '2h');
  assert.equal(formatDuration(59), '0m');
  assert.equal(bar(62, 6), '▰▰▰▰▱▱');
  assert.equal(bar(0, 4), '▱▱▱▱');
  assert.equal(bar(130, 4), '▰▰▰▰');
  assert.equal(bar(50, 0), '');
});

test('glyph sets and the smooth bar', () => {
  assert.equal(bar(50, 4, 'dots'), '●●○○');
  assert.equal(bar(50, 4, 'unknown'), '▰▰▱▱');
  assert.equal(bar(100, 4, 'smooth'), '████');
  assert.equal(bar(0, 4, 'smooth'), '░░░░');
  assert.equal(bar(31.25, 4, 'smooth'), '█▎░░'); // 1.25 cells: one full, a quarter
  for (const p of [0, 7, 33, 61, 99, 100]) assert.equal([...bar(p, 6, 'smooth')].length, 6);
});

test('segments light from the left and carry their midpoint', () => {
  const s = segments(62, 10);
  assert.equal(s.filter((x) => x.lit).length, 6);
  assert.equal(s[0].at, 5);
  assert.equal(s[9].at, 95);
  assert.equal(segments(4, 10).some((x) => x.lit), false);
});

test('bands: below 60 green, 60 to 90 yellow, 90 and up red', () => {
  const p = PALETTES.subtle;
  const t = { warnAt: 60, criticalAt: 90 };
  assert.equal(colorAt(59.9, t, p, 'bands'), p.ok);
  assert.equal(colorAt(60, t, p, 'bands'), p.warn);
  assert.equal(colorAt(89, t, p, 'bands'), p.warn);
  assert.equal(colorAt(90, t, p, 'bands'), p.critical);
});

test('gradient: pure colours away from thresholds, blends just before them', () => {
  const p = PALETTES.vivid;
  const t = { warnAt: 60, criticalAt: 90 };
  assert.equal(colorAt(30, t, p, 'gradient'), mix(p.ok, p.ok, 0));
  assert.equal(colorAt(55, t, p, 'gradient'), mix(p.ok, p.warn, 0.5));
  assert.equal(colorAt(60, t, p, 'gradient'), mix(p.warn, p.warn, 0));
  assert.equal(colorAt(85, t, p, 'gradient'), mix(p.warn, p.critical, 0.5));
  assert.equal(colorAt(95, t, p, 'gradient'), p.critical);
});

test('colour helpers', () => {
  assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080');
  assert.equal(mix('#000', '#fff', 2), '#FFFFFF');
  assert.equal(withAlpha('#8fbc8f', 1), '#8FBC8F');
  assert.equal(withAlpha('#8FBC8F', 0.5), '#8FBC8F80');
  assert.equal(isHex('#abc'), true);
  assert.equal(isHex('#abcd'), false);
  assert.equal(isHex('red'), false);
  for (const p of Object.values(PALETTES)) for (const c of Object.values(p)) assert.ok(isHex(c), c);
});

test('motion helpers', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(5), 1);
  assert.equal(pulse(0, 2000), 0);
  assert.equal(pulse(1000, 2000), 1);
  const frames = new Set(Array.from({ length: 200 }, (_, i) => pulse(i * 10, 2000)));
  assert.ok(frames.size <= 9, 'quantised to at most 9 distinct values');
});
