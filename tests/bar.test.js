'use strict';
// 2.7: the Next/Finish bar and the forgotten-Finish check.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const H = 3600e3;
const done = t => ({ w: '60', r: '8', done: true, ...(t != null ? { t } : {}) });
const open = () => ({ w: '', r: '', done: false });
const sk = () => ({ w: '', r: '', done: false, skip: true });

test('nextSet: the first undone, unskipped set of the current card', () => {
  assert.deepEqual(C.nextSet({ slots: [{ sets: [open(), open()] }] }), { i: 0, j: 0 });
  assert.deepEqual(C.nextSet({ slots: [{ sets: [done(1), sk(), open()] }, { sets: [open()] }] }), { i: 0, j: 2 });
  assert.deepEqual(C.nextSet({ slots: [{ sets: [done(1)] }, { sets: [open()] }] }), { i: 1, j: 0 });
  assert.equal(C.nextSet({ slots: [{ sets: [done(1), sk()] }] }), null);
});

test('allLogged: every set ticked or skipped, and something ticked', () => {
  assert.equal(C.allLogged({ slots: [{ sets: [done(1), sk()] }, { skip: true, sets: [sk()] }] }), true);
  assert.equal(C.allLogged({ slots: [{ sets: [done(1), open()] }] }), false);
  assert.equal(C.allLogged({ slots: [{ sets: [sk()] }] }), false);
});

test('lastTick: newest t of the done sets', () => {
  assert.equal(C.lastTick({ slots: [{ sets: [done(5), done(9), open()] }, { sets: [done(7), { ...open(), t: 99 }] }] }), 9);
  assert.equal(C.lastTick({ slots: [{ sets: [done(), open()] }] }), null);
});

test('staleSession: the newest unfinished session with its last tick over 6 h ago', () => {
  const now = 100 * H;
  const m = { log: {
    '0-0': { done: true, slots: [{ sets: [done(1 * H)] }] },                    // finished: never stale
    '0-1': { done: false, slots: [{ sets: [done(80 * H), done(90 * H)] }] },     // last tick 10 h ago
    '0-2': { done: false, skipped: true, slots: [{ sets: [] }] },
    '1-0': { done: false, slots: [{ sets: [open()] }] },                          // nothing ticked
  } };
  assert.deepEqual(C.staleSession(m, now), { key: '0-1', w: 0, d: 1, t: 90 * H });
  assert.equal(C.staleSession(m, 95 * H), null);                                 // only 5 h
  m.log['1-1'] = { done: false, slots: [{ sets: [done(92 * H)] }] };
  assert.equal(C.staleSession(m, now).key, '1-1');
  assert.equal(C.staleSession(null, now), null);
  assert.equal(C.isStale(m.log['0-1'], now), true);
  assert.equal(C.isStale(m.log['0-1'], 95 * H), false);
  assert.equal(C.isStale(m.log['1-0'], now), false);
});

test('finishing a stale session dates it by its sets, not by now (1.6 rule)', () => {
  const m = { id: 'm', weeks: 2, deload: false, style: 'fixed', pos: { w: 0, d: 0 }, log: {},
    days: [{ name: 'A', weekday: null, exercises: [{ exId: 'a', plan: [2], reps: [8, 10], type: 'main' }] }] };
  const s = C.session(m, 0, 0, true);
  s.slots[0].sets = [done(10 * H), done(10.1 * H)];
  C.finishSession(m, 0, 0, s, 40 * H);
  assert.equal(s.date, 10 * H);
});
