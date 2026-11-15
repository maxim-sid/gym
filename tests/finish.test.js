'use strict';
// 1.6: the Finish sheet (typed sets never dropped silently), the first-tick date and Undo for Finish.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const set = (w, r, done = true, t) => ({ w: String(w), r: String(r), done, ...(t ? { t } : {}) });
const blank = () => ({ w: '', r: '', done: false });
const lift = { bw: false };

function meso(style = 'rp') {
  return {
    id: 'm', weeks: 3, deload: false, style, pos: { w: 0, d: 0 }, complete: false, log: {},
    days: [{ name: 'A', weekday: null, exercises: [
      { exId: 'a', plan: [3], reps: [8, 10], type: 'main' },
      { exId: 'b', plan: [2], reps: [10, 12], type: 'accessory' },
    ] }, { name: 'B', weekday: null, exercises: [{ exId: 'c', plan: [2], reps: [6, 8], type: 'main' }] }],
  };
}
// accept() as the app does it: the typed values (no suggestion), through acceptSet.
const acceptFrom = s => (i, j) => C.acceptSet(s.slots[i].sets[j], { w: '', r: '' }, lift);

test('finishReview: counts, typed list, empty count, nothing', () => {
  const m = meso();
  const s = C.session(m, 0, 0, true);
  assert.deepEqual(C.finishReview(s), { exercises: 0, of: 2, sets: 0, typed: [], empty: 5, nothing: true });
  s.slots[0].sets[0] = set(60, 8, true, 5);
  s.slots[0].sets[1] = { w: '60', r: '', done: false };
  s.slots[1].sets[1] = { w: '', r: '12', done: false };
  s.slots[1].sets[0] = { w: '9', r: '9', done: false, skip: true };
  assert.deepEqual(C.finishReview(s), { exercises: 1, of: 2, sets: 1, typed: [{ i: 0, j: 1 }, { i: 1, j: 1 }], empty: 1, nothing: false });
});

test('Log them: typed-unticked sets become done (with t); an invalid one changes nothing', () => {
  const m = meso();
  const s = C.session(m, 0, 0, true);
  s.slots[0].sets[0] = { w: '60', r: '8', done: false };
  s.slots[1].sets[0] = { w: '20', r: '12', done: false };
  const list = C.finishReview(s).typed;
  assert.deepEqual(C.applyTyped(s, list, acceptFrom(s), 'log', 77), { ok: true });
  assert.deepEqual(s.slots[0].sets[0], { w: '60', r: '8', done: true, t: 77 });
  assert.deepEqual(s.slots[1].sets[0], { w: '20', r: '12', done: true, t: 77 });

  const s2 = C.session(m, 1, 0, true);
  s2.slots[0].sets[0] = { w: '60', r: '8', done: false };
  s2.slots[1].sets[0] = { w: '', r: '12', done: false }; // weighted lift, no weight → refused
  const before = JSON.parse(JSON.stringify(s2));
  assert.deepEqual(C.applyTyped(s2, C.finishReview(s2).typed, acceptFrom(s2), 'log', 1), { error: 'weight', i: 1, j: 0 });
  assert.deepEqual(s2, before);
});

test('Skip them: skip:true, values kept through finish; excluded from stats and history', () => {
  const m = meso();
  const s = C.session(m, 0, 0, true);
  s.slots[0].sets[0] = set(60, 8, true, 10);
  s.slots[0].sets[1] = { w: '60', r: '6', done: false };
  C.applyTyped(s, C.finishReview(s).typed, acceptFrom(s), 'skip', 1);
  C.finishSession(m, 0, 0, s, 999);
  assert.deepEqual(s.slots[0].sets, [set(60, 8, true, 10), { w: '60', r: '6', done: false, skip: true }]);
  const S = { exercises: [], mesos: [m] };
  assert.deepEqual(C.perfFor(S, 'a')[0].sets.map(x => x.r), ['8']);
  assert.deepEqual(C.lastPerf(S, 'a').sets.map(x => x.r), ['8']);
  const total = C.allSessions(S).reduce((n, { s: ss }) => n + ss.slots.reduce((k, sl) => k + C.doneSets(sl).length, 0), 0);
  assert.equal(total, 1);
  assert.equal(C.fmtSets(C.doneSets(s.slots[0]), lift, 'kg'), '60×8');
});

test('finishSession: empty unticked removed AFTER base; date = earliest tick; bump deleted', () => {
  const m = meso();
  const s = C.session(m, 0, 0, true);
  s.slots[0].sets = [set(60, 8, true, 300), set(60, 8, true, 200), blank()];
  s.slots[0].fb = { sore: 0, pump: 0, work: 0 }; // +2 on base 3 (the empty set counts)
  s.slots[0].bump = [2];
  s.slots[1].sets = [blank(), blank()];
  const r = C.finishSession(m, 0, 0, s, 5000);
  assert.deepEqual(s.slots.map(sl => sl.sets.length), [2, 0]);
  assert.deepEqual(m.days[0].exercises[0].plan, [3, 5]);
  assert.deepEqual(r.changes[0], { exId: 'a', from: 3, to: 5 });
  assert.equal(s.date, 200);
  assert.ok(s.slots.every(sl => !('bump' in sl)));
});

test('finishSession: no ticks with a time → date falls back to now', () => {
  const m = meso('fixed');
  const s = C.session(m, 0, 0, true);
  s.slots[0].sets[0] = set(60, 8); // ticked before 1.3 (no t)
  C.finishSession(m, 0, 0, s, 4242);
  assert.equal(s.date, 4242);
});

test('finishSnapshot/restoreFinish round-trip exactly: session, plan, next session, pos, complete', () => {
  const m = meso();
  const s = C.session(m, 0, 0, true);
  s.slots[0].sets = [set(60, 8, true, 1), { w: '60', r: '7', done: false }, blank()];
  s.slots[0].fb = { sore: 0, pump: 0, work: 0 };
  s.slots[0].bump = [1];
  const next = C.session(m, 1, 0, true); // created early, untouched → finish resets it
  const before = JSON.parse(JSON.stringify(m));
  const snap = C.finishSnapshot(m, 0, 0);
  C.applyTyped(s, C.finishReview(s).typed, acceptFrom(s), 'log', 2);
  C.finishSession(m, 0, 0, s, 3);
  assert.notDeepEqual(JSON.parse(JSON.stringify(m)), before);
  assert.notDeepEqual(next.slots[0].sets.length, 3);
  C.restoreFinish(m, snap);
  assert.deepEqual(JSON.parse(JSON.stringify(m)), before);
});

test('restoreFinish removes a next-week session that did not exist before', () => {
  const m = meso();
  const s = C.session(m, 0, 0, true);
  s.slots[0].sets[0] = set(60, 8, true, 1);
  const snap = C.finishSnapshot(m, 0, 0);
  C.finishSession(m, 0, 0, s, 3);
  m.log['1-0'] = C.blankSession(m, 1, 0); // e.g. created by the next screen
  C.restoreFinish(m, snap);
  assert.equal(m.log['1-0'], undefined);
  assert.equal(m.log['0-0'].done, false);
});

test('ticking a skipped set (while editing) clears skip', () => {
  const st = { w: '60', r: '6', done: false, skip: true };
  C.tickSet(st, { w: '60', r: '6' }, 9);
  assert.deepEqual(st, { w: '60', r: '6', done: true, t: 9 });
});
