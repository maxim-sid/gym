'use strict';
// 3.2: the 🏆 personal-best set, on the same metric as the exercise's chart.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const set = (w, r, done = true) => ({ w: String(w), r: String(r), done });
function S(ex, past, settings = {}) {
  const log = Object.fromEntries(past.map((sets, k) => [`${k}-0`, { date: 100 + k, done: true, slots: [{ exId: ex.id, sets, fb: {} }] }]));
  return { settings, exercises: [ex], mesos: [{ id: 'm', weeks: 9, deload: false, days: [], log }] };
}
const today = (exId, sets) => ({ done: false, slots: [{ exId, sets, fb: {} }] });

test('weighted: e1RM over 1–12 reps beats every earlier workout → that set; ties and warm-ups never', () => {
  const ex = { id: 'sq' };
  const st = S(ex, [[set(100, 8)], [set(105, 5), set(60, 20)]]);           // best e1RM so far: 100×8 ≈ 126.7
  assert.equal(Math.round(C.bestBefore(st, 'sq', 'e1rm', null)), 127);
  const s = today('sq', [set(100, 8), set(110, 6), { ...set(200, 5), wu: true }, set(105, 8, false)]);
  assert.deepEqual(C.prSet(st, ex, s), { i: 0, j: 1, value: C.e1rm(110, 6), metric: 'e1rm' });
  assert.equal(C.prSet(st, ex, today('sq', [set(100, 8)])), null);         // equal: no record
  assert.equal(C.prSet(st, ex, today('sq', [set(80, 30)])), null);         // > 12 reps: says nothing
});

test('first workout ever: no record; only the best set of the day (across slots) gets it', () => {
  const ex = { id: 'sq' };
  assert.equal(C.prSet(S(ex, []), ex, today('sq', [set(100, 8)])), null);
  const st = S(ex, [[set(100, 5)]]);
  const s = { done: false, slots: [{ exId: 'sq', sets: [set(110, 5)], fb: {} }, { exId: 'x', sets: [set(500, 5)], fb: {} }, { exId: 'sq', sets: [set(115, 5)], fb: {} }] };
  assert.deepEqual(C.prSet(st, ex, s), { i: 2, j: 0, value: C.e1rm(115, 5), metric: 'e1rm' });
});

test('other metrics follow the chart: hold, added load, e1RM incl. bodyweight', () => {
  const hold = { id: 'h', timed: true };
  assert.equal(C.prSet(S(hold, [[set('', 30)]]), hold, today('h', [set('', 35)])).value, 35);
  const dip = { id: 'd', bw: true };
  const past = [[set('', 10), set(10, 6)]];
  assert.equal(C.prSet(S(dip, past), dip, today('d', [set(15, 4)])).metric, 'load');
  assert.equal(C.prSet(S(dip, past), dip, today('d', [set(10, 8)])), null);   // same load: no record on "load"
  const withBw = S(dip, past, { bodyweight: 80 });
  const r = C.prSet(withBw, dip, today('d', [set(10, 8)]));                    // 90×8 beats 90×6 on e1RM
  assert.equal(r.metric, 'e1rmBw');
  assert.equal(Math.round(r.value), Math.round(C.e1rm(90, 8)));
});

test('a finished workout compares only with what came before it', () => {
  const ex = { id: 'sq' };
  const st = S(ex, [[set(100, 5)], [set(120, 5)], [set(110, 5)]]);
  const s1 = st.mesos[0].log['1-0'];
  assert.equal(C.prSet(st, ex, s1).value, C.e1rm(120, 5));                  // it beat the 100 before it
  assert.equal(C.prSet(st, ex, st.mesos[0].log['2-0']), null);
});

test('chart points and records use the same metric and bodyweight (bwFor): s.bw, then the Body log, then current', () => {
  const ex = { id: 'd', bw: true };
  const day = d => new Date(2026, 9, d, 10).getTime();
  const sess = (date, sets, bw) => ({ date, done: true, ...(bw ? { bw } : {}), slots: [{ exId: 'd', sets, fb: {} }] });
  const st = { settings: {}, body: [{ d: '2026-10-05', w: '90' }], exercises: [ex], mesos: [{ id: 'm', weeks: 9, deload: false, days: [], log: {
    '0-0': sess(day(1), [set('', 10)]),            // before the log: current value (90 — the only entry)
    '1-0': sess(day(6), [set(5, 8)]),              // log: 90
    '2-0': sess(day(9), [set('', 12)], 85),        // saved: 85
  } }] };
  assert.equal(C.chartMetric(st, ex), 'e1rmBw');
  const { points } = C.chartPoints(st, ex);
  const logs = Object.values(st.mesos[0].log);
  logs.forEach((s, k) => {
    const v = Math.max(...s.slots[0].sets.map(x => C.setValue('e1rmBw', x, C.bwFor(st, s))));
    assert.equal(points[k].y, v);
  });
  assert.equal(C.bwFor(st, logs[0]), 90);
  assert.equal(C.bwFor(st, logs[2]), 85);
  // The record compares the same numbers: the best before day 9 is the top chart point of days 1 and 6.
  assert.equal(C.bestBefore(st, 'd', 'e1rmBw', logs[2]), Math.max(points[0].y, points[1].y));
  assert.equal(C.prSet(st, ex, logs[2]) === null, points[2].y <= Math.max(points[0].y, points[1].y));
});
