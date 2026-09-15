import test from 'node:test';
import assert from 'node:assert/strict';
import { previousRange, percentChange, flowAnalysis, coreMix } from '../src/components/dashboard/analytics.ts';

test('comparison is adjacent and equal length across leap days and year boundaries', () => {
  assert.deepEqual(previousRange('2024-03-01', '2024-03-02'), { from: '2024-02-28', to: '2024-02-29', days: 2 });
  assert.deepEqual(previousRange('2026-01-01', '2026-01-01'), { from: '2025-12-31', to: '2025-12-31', days: 1 });
  assert.deepEqual(previousRange('2026-09-01', '2026-09-15'), { from: '2026-08-17', to: '2026-08-31', days: 15 });
});
test('invalid, empty and reversed ranges never yield a misleading comparison', () => {
  for (const [from, to] of [['', '2026-09-15'], ['2026-02-30', '2026-03-02'], ['2026-09-20', '2026-09-15']]) {
    assert.equal(previousRange(from, to), null);
  }
});
test('zero baselines are unavailable instead of infinite growth', () => {
  assert.equal(percentChange(100, 0), null);
  assert.equal(percentChange(0, 0), null);
  assert.equal(percentChange(150, 100), 50);
  assert.equal(percentChange(0, 100), -100);
});
const series = {
  days: ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16'],
  pendingProduction: [30, 0, 60, 900], dispatched: [50, 20, 40, 999],
  salesOrders: [0, 0, 0, 0], readyDispatch: [-20, -20, 20, -99], openReturns: [0, 0, 0, 0],
};
test('pace includes idle days, excludes future entries, and keeps negative flow', () => {
  const flow = flowAnalysis(series, '2026-09-15');
  assert.equal(flow.produced, 90);
  assert.equal(flow.dispatched, 110);
  assert.equal(flow.dailyPace, 30);
  assert.equal(flow.activeDays, 2);
  assert.equal(flow.days, 3);
  assert.equal(flow.net, -20);
  assert.deepEqual(flow.peak, { day: '2026-09-15', pcs: 60 });
});
test('future-only activity has no pace or fabricated peak', () => {
  const flow = flowAnalysis(series, '2026-09-12');
  assert.equal(flow.dailyPace, null);
  assert.equal(flow.peak, null);
  assert.equal(flow.days, 0);
});
test('core composition includes uncategorized pieces and handles empty orders', () => {
  const mix = coreMix({ salesOrders: { pcs: 100, toroidalPcs: 40, rectangularPcs: 35 } });
  assert.deepEqual(mix.map(({ share }) => share), [40, 35, 25]);
  const empty = coreMix({ salesOrders: { pcs: 0, toroidalPcs: 0, rectangularPcs: 0 } });
  assert.deepEqual(empty.map(({ share }) => share), [0, 0, 0]);
});
