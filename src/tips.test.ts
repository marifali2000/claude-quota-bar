import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { GENERAL_TIPS, pickTip, situationalTips } from './tips';

test('no situation, general tips rotate', () => {
  assert.equal(pickTip({}, 0), GENERAL_TIPS[0]);
  assert.equal(pickTip({}, 1), GENERAL_TIPS[1]);
  assert.equal(pickTip({}, GENERAL_TIPS.length), GENERAL_TIPS[0]);
});

test('situational tips come first and alternate with general ones', () => {
  const c = { contextPercent: 72, sessionLevel: 'critical' as const, sessionResetsIn: '40m' };
  const urgent = situationalTips(c);
  assert.equal(urgent.length, 2);
  assert.match(urgent[0], /resets in 40m/);
  assert.match(urgent[1], /72% full/);
  assert.equal(pickTip(c, 0), urgent[0]);
  assert.equal(pickTip(c, 1), GENERAL_TIPS[1]);
  assert.equal(pickTip(c, 2), urgent[1]);
});

test('thresholds for situational tips', () => {
  assert.equal(situationalTips({ contextPercent: 59 }).length, 0);
  assert.equal(situationalTips({ weeklyLevel: 'ok', cacheHitRatio: 0.9 }).length, 0);
  assert.equal(situationalTips({ weeklyLevel: 'warn', cacheHitRatio: 0.2 }).length, 2);
});
