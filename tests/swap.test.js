'use strict';
// 2.2: swap an exercise for today only; history stays with the exercise actually done (KNOWN-1).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const set = (w, r, done = true) => ({ w: String(w), r: String(r), done });
const blank = () => ({ w: '', r: '', done: false });
const ex = (id, name, muscle) => ({ id, name, muscle, bw: false, timed: false });

function state() {
  const exercises = [
    ex('dips', 'Weighted Dips', 'Chest'), ex('incl', 'Incline Dumbbell Press', 'Chest'), ex('bench', 'Barbell Bench Press', 'Chest'),
    ex('fly', 'Cable Fly', 'Chest'), ex('pec', 'Pec Deck', 'Chest'), ex('ring', 'Ring Dip', 'Chest'),
    ex('sq', 'Back Squat', 'Quads'), ex('lp', 'Leg Press', 'Quads'), ex('row', 'Cable Row', 'Back'),
  ];
  const day = { name: 'D', weekday: null, exercises: [{ exId: 'dips', plan: [3], reps: [6, 8], type: 'main', notes: 'Hard set first' }, { exId: 'sq', plan: [2], reps: [6, 8], type: 'main' }] };
  const m = { id: 'b1', weeks: 4, deload: false, style: 'fixed', days: [day], pos: { w: 0, d: 0 }, log: {} };
  m.log['0-0'] = { date: 100, done: true, slots: [{ exId: 'incl', sets: [set(30, 8)], fb: {} }, { exId: 'sq', sets: [set(100, 8)], fb: {} }] };
  m.log['1-0'] = { date: 200, done: true, slots: [{ exId: 'bench', sets: [set(80, 6)], fb: {} }, { exId: 'sq', sets: [set(100, 8)], fb: {} }] };
  m.log['2-0'] = { date: 300, done: true, slots: [{ exId: 'dips', sets: [set(20, 8)], fb: {} }, { exId: 'sq', sets: [set(105, 6)], fb: {} }] };
  return { exercises, mesos: [m], activeId: 'b1' };
}

test('swapCandidates: recent same-muscle by last date, then the rest A–Z, then other muscles; current excluded', () => {
  const g = C.swapCandidates(state(), 'dips');
  assert.equal(g.muscle, 'Chest');
  assert.deepEqual(g.recent.map(r => [r.ex.id, r.date]), [['bench', 200], ['incl', 100]]);
  assert.deepEqual(g.all.map(e => e.id), ['fly', 'pec', 'ring']);
  assert.deepEqual(g.other.map(o => [o.muscle, o.items.map(e => e.id)]), [['Back', ['row']], ['Quads', ['sq', 'lp']]]);
  assert.equal(g.add, null);
  const ids = [...g.recent.map(r => r.ex.id), ...g.all.map(e => e.id), ...g.other.flatMap(o => o.items.map(e => e.id))];
  assert.equal(ids.includes('dips'), false);
});

test('swapCandidates: search filters every group; add offered only without an exact name match', () => {
  const S = state();
  let g = C.swapCandidates(S, 'dips', 'dip');
  assert.deepEqual([g.recent.length, g.all.map(e => e.id), g.other.length], [0, ['ring'], 0]);
  assert.equal(g.add, 'dip');
  g = C.swapCandidates(S, 'dips', '  ring DIP ');
  assert.deepEqual(g.all.map(e => e.id), ['ring']);
  assert.equal(g.add, null);                          // exact match (any case) → no add row
  g = C.swapCandidates(S, 'dips', 'weighted dips');
  assert.equal(g.add, null);                          // the current exercise's own name is no new exercise
  g = C.swapCandidates(S, 'dips', 'press');
  assert.deepEqual([g.recent.map(r => r.ex.id), g.other.map(o => o.items[0].id)], [['bench', 'incl'], ['lp']]);
  g = C.swapCandidates(S, 'dips', 'Ring Row');
  assert.equal(g.add, 'Ring Row');
});

test('swapToday: new exercise, undone sets emptied, feedback/skip/bump reset; Undo restores everything', () => {
  const s = { date: null, done: false, slots: [{ exId: 'dips', sets: [set(20, 8, false), blank()], fb: { pump: 1 }, skip: true, bump: [0] }] };
  const before = JSON.parse(JSON.stringify(s.slots[0]));
  const sl = s.slots[0];
  const r = C.swapToday(s, 0, 'ring');
  assert.ok(r.snap);
  assert.equal(sl.exId, 'ring');
  assert.deepEqual(sl.sets, [blank(), blank()]);
  assert.deepEqual(sl.fb, {});
  assert.equal('skip' in sl, false);
  assert.equal('bump' in sl, false);
  C.restoreSlot(sl, r.snap);
  assert.deepEqual(sl, before);
  assert.equal(s.slots[0], sl);                        // restored in place
});

test('swapToday refuses when a set is done, or the same exercise', () => {
  const s = { slots: [{ exId: 'dips', sets: [set(20, 8), blank()], fb: {} }] };
  assert.deepEqual(C.swapToday(s, 0, 'ring'), { error: 'done' });
  assert.equal(s.slots[0].exId, 'dips');
  assert.deepEqual(C.swapToday({ slots: [{ exId: 'dips', sets: [], fb: {} }] }, 0, 'dips'), { error: 'same' });
  assert.deepEqual(C.swapToday(s, 5, 'ring'), { error: 'missing' });
});

test('swappedFrom / unswap: back to the planned exercise while no set is done', () => {
  const S = state(), m = S.mesos[0];
  const s = { slots: [{ exId: 'dips', sets: [blank()], fb: {} }, { exId: 'sq', sets: [], fb: {} }] };
  assert.equal(C.swappedFrom(m, 0, s, 0), null);
  C.swapToday(s, 0, 'ring');
  assert.equal(C.swappedFrom(m, 0, s, 0), 'dips');
  s.slots[0].sets[0].w = '10';
  assert.ok(C.unswap(m, 0, s, 0).snap);
  assert.equal(s.slots[0].exId, 'dips');
  assert.deepEqual(s.slots[0].sets, [blank()]);
  assert.deepEqual(C.unswap(m, 0, s, 0), { error: 'same' });
  C.swapToday(s, 0, 'ring'); s.slots[0].sets[0] = set(10, 8);
  assert.deepEqual(C.unswap(m, 0, s, 0), { error: 'done' });
});

test('KNOWN-1: a substitute’s weights never show up as the planned exercise’s last time, and vice versa', () => {
  const S = state(), m = S.mesos[0];
  // Week 4: the dips slot was swapped to Ring Dip and logged at 0 kg × 12.
  m.log['3-0'] = { date: 400, done: true, slots: [{ exId: 'ring', sets: [set(0, 12)], fb: {} }, { exId: 'sq', sets: [set(105, 7)], fb: {} }] };
  assert.equal(C.lastPerf(S, 'dips').date, 300);
  assert.deepEqual(C.lastPerf(S, 'dips').sets, [set(20, 8)]);
  assert.deepEqual(C.lastPerf(S, 'ring').sets, [set(0, 12)]);
  // ...and today's prefill follows the swapped exercise.
  const s = { slots: [{ exId: 'dips', sets: [blank(), blank()], fb: {} }] };
  C.swapToday(s, 0, 'incl');
  const last = C.lastPerf(S, s.slots[0].exId, { exclude: s });
  assert.equal(C.prefill(s.slots[0], 0, last, S.exercises[1], { step: 2 }).w, '30');
  // Progress/charts go by exId too.
  assert.deepEqual(C.perfFor(S, 'dips').map(p => p.date), [300]);
  assert.deepEqual(C.perfFor(S, 'ring').map(p => p.date), [400]);
});
