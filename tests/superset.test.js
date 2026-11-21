'use strict';
// 4.1: supersets — plan slot link:true joins the next exercise; A1 → B1 → A2 → B2; rest after the round.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const set = (done = false, t) => ({ w: done ? '10' : '', r: done ? '10' : '', done, ...(t ? { t } : {}) });
const wu = (done = false) => ({ ...set(done), wu: true });
const sk = () => ({ w: '', r: '', done: false, skip: true });
const slot = (exId, extra = {}) => ({ exId, plan: [3], reps: [8, 10], type: 'accessory', ...extra });
const meso = exs => ({ id: 'm', weeks: 4, deload: false, style: 'fixed', pos: { w: 0, d: 0 }, log: {}, days: [{ name: 'A', weekday: null, exercises: exs }] });
const sess = (...sets) => ({ done: false, slots: sets.map((ss, i) => ({ exId: `x${i}`, sets: ss, fb: {} })) });

test('groups: links chain to the next exercise; retired slots and missing session slots are passed over', () => {
  const m = meso([slot('a', { link: true }), slot('b'), slot('c', { link: true }), slot('d', { link: true }), slot('e'), slot('f')]);
  assert.deepEqual(C.groups(m, 0), [[0, 1], [2, 3, 4], [5]]);
  m.days[0].exercises[1].off = true;                                   // a retired member: a's link reaches c
  assert.deepEqual(C.groups(m, 0), [[0, 2, 3, 4], [1], [5]]);
  const s = sess([set()], [set()], [set()], [set()]);                  // a session without slots 4 and 5
  assert.deepEqual(C.groups(m, 0, s), [[0, 2, 3], [1]]);
  assert.deepEqual(C.groupOf(m, 0, 3), [0, 2, 3, 4]);
  assert.deepEqual(C.groupOf(m, 0, 5), [5]);
  assert.deepEqual(C.groupLabels(C.groups(m, 0)), { 0: 'A1', 2: 'A2', 3: 'A3', 4: 'A4' });
  m.days[0].exercises[1].off = false;
  assert.deepEqual(C.groupLabels(C.groups(m, 0)), { 0: 'A1', 1: 'A2', 2: 'B1', 3: 'B2', 4: 'B3' });
});

test('2 members: A1 → B1 → A2 → B2; rest only after the round', () => {
  const G = [[0, 1]];
  const s = sess([set(), set()], [set(), set()]);
  assert.deepEqual(C.nextSet(s, G), { i: 0, j: 0 });
  s.slots[0].sets[0] = set(true, 1);
  assert.equal(C.restAfterTick(s, G[0], 0, 0), false);                 // B1 still to do
  assert.deepEqual(C.nextSet(s, G), { i: 1, j: 0 });
  s.slots[1].sets[0] = set(true, 2);
  assert.equal(C.restAfterTick(s, G[0], 1, 0), true);                  // round 1 done
  assert.deepEqual(C.nextSet(s, G), { i: 0, j: 1 });
  assert.equal(C.currentSlot(s, G), 0);
});

test('3 members with unequal sets: the longer one goes on alone; a skipped member and skipped sets drop out', () => {
  const G = [[0, 1, 2]];
  const s = sess([set(true, 1), set()], [set(true, 2), set(), set()], [set(true, 3), set()]);
  assert.deepEqual(C.nextSet(s, G), { i: 0, j: 1 });
  s.slots[0].sets[1] = set(true, 4); s.slots[1].sets[1] = set(true, 5);
  assert.deepEqual(C.nextSet(s, G), { i: 2, j: 1 });
  s.slots[2].sets[1] = set(true, 6);
  assert.equal(C.restAfterTick(s, G[0], 2, 1), true);
  assert.deepEqual(C.nextSet(s, G), { i: 1, j: 2 });                    // only B has a third set
  s.slots[1].sets[2] = set(true, 7);
  assert.equal(C.restAfterTick(s, G[0], 1, 2), true);                  // alone: rests after every set
  // Skipped member / skipped set.
  const t = sess([set(), set()], [set(), set()], [set(), set()]);
  t.slots[1].skip = true;
  t.slots[2].sets[0] = sk();
  assert.deepEqual(C.nextSet(t, G), { i: 0, j: 0 });
  t.slots[0].sets[0] = set(true, 1);
  assert.equal(C.restAfterTick(t, G[0], 0, 0), true);                  // B skipped, C's round-1 set skipped
  assert.deepEqual(C.nextSet(t, G), { i: 0, j: 1 });
});

test('ticking out of order: the earliest open round comes first; warm-ups never take part', () => {
  const G = [[0, 1]];
  const s = sess([wu(), set(), set()], [set(), set()]);
  assert.deepEqual(C.nextSet(s, G), { i: 0, j: 1 });                    // not the warm-up
  s.slots[1].sets[1] = set(true, 5);                                    // B2 ticked first
  assert.equal(C.restAfterTick(s, G[0], 1, 1), false);                 // A2 still open in round 2
  assert.deepEqual(C.nextSet(s, G), { i: 0, j: 1 });                    // back to round 1: A1
  s.slots[0].sets[0] = wu(true);
  assert.equal(C.restAfterTick(s, G[0], 0, 0), false);                 // a warm-up never starts rest
});

test('singletons behave as before; the latest ticked group stays current while it has work', () => {
  const s = sess([set(), set()], [set(), set()], [set()]);
  assert.deepEqual(C.nextSet(s), { i: 0, j: 0 });
  const G = [[0], [1, 2]];
  s.slots[1].sets[0] = set(true, 9);                                   // logging out of order in the superset
  assert.deepEqual(C.nextSet(s, G), { i: 2, j: 0 });
  assert.equal(C.restAfterTick(s, [0], 0, 1), true);
});

test('appendSlot never links: a dangling link on the last exercise goes (Undo restores it)', () => {
  const m = meso([slot('a', { link: true }), slot('b', { off: true })]);
  const r = C.appendSlot(m, 0, 'z');
  assert.equal(m.days[0].exercises[0].link, undefined);
  assert.deepEqual(C.groups(m, 0), [[0], [1], [2]]);
  C.removeAppended(m, 0, r);
  assert.equal(m.days[0].exercises[0].link, true);
});

test('dropTrailingLink: the last exercise links to nothing (remove, append, copy)', () => {
  const exs = [slot('a', { link: true }), slot('b', { link: true })];
  assert.equal(C.dropTrailingLink(exs), exs);
  assert.deepEqual(exs.map(e => !!e.link), [true, false]);
  assert.deepEqual(C.dropTrailingLink([]), []);
});
