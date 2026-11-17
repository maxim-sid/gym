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
