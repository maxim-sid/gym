'use strict';
// Characterization tests: they pin the CURRENT behaviour (quirks included) of the logic moved out of
// app.js, so later phases change it deliberately, one test at a time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../core.js');

const fixture = () => {
  const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'v1-sample.json'), 'utf8'));
  C.normalize(s);
  return s;
};

// A small rp meso: 2 days (Sat, Wed), 3 hard weeks + deload. Day 0 has two slots.
function rpMeso(over = {}) {
  return {
    id: 'm', name: 'T', weeks: 3, deload: true, style: 'rp', log: {}, pos: { w: 0, d: 0 }, complete: false,
    days: [
      { name: 'A', weekday: 6, exercises: [
        { exId: 'a', plan: [3], reps: [8, 10], type: 'main' },
        { exId: 'b', plan: [2], reps: [10, 12], type: 'accessory' },
      ] },
      { name: 'B', weekday: 3, exercises: [{ exId: 'c', plan: [2], reps: [6, 8], type: 'main' }] },
    ],
    ...over,
  };
}
const set = (w, r, done = true) => ({ w: String(w), r: String(r), done });

/* ---------- small helpers ---------- */

test('e1rm, roundLoad, parseReps, repsTxt', () => {
  assert.equal(C.e1rm(100, 0), 100);
  assert.equal(C.e1rm(100, 30), 200);
  assert.equal(C.e1rm(0, 10), 0);
  assert.equal(C.roundLoad(16.5, 'kg'), 17.5); // 14 kg DB + 2.5 → 17.5 (F15 quirk, fixed in 1.4b)
  assert.equal(C.roundLoad(7, 'kg'), 7.5);     // deload half of 14 kg
  assert.equal(C.roundLoad(1.2, 'kg'), 0);
  assert.equal(C.roundLoad(47, 'lb'), 45);
  assert.equal(C.roundLoad(48, 'lb'), 50);
  assert.deepEqual(C.parseReps('8-10'), [8, 10]);
  assert.deepEqual(C.parseReps('10–8'), [8, 10]);
  assert.deepEqual(C.parseReps(' 12 '), [12, 12]);
  assert.deepEqual(C.parseReps('6 - 8 reps'), [6, 8]);
  assert.equal(C.parseReps(''), null);
  assert.equal(C.parseReps('abc'), null);
  assert.equal(C.repsTxt([8, 10]), '8–10');
  assert.equal(C.repsTxt([15, 15]), '15');
  assert.equal(C.repsTxt([15, 20], true), '15–20 s');
  assert.equal(C.repsTxt(null), '');
});

test('doneSets / blankSets / totalWeeks / isDeload / isFixed / targetRIR', () => {
  assert.deepEqual(C.doneSets({ sets: [set(1, 1), set(2, 2, false)] }), [set(1, 1)]);
  assert.deepEqual(C.blankSets(2), [{ w: '', r: '', done: false }, { w: '', r: '', done: false }]);
  const m = rpMeso();
  assert.equal(C.totalWeeks(m), 4);
  assert.equal(C.totalWeeks({ ...m, deload: false }), 3);
  assert.equal(C.isDeload(m, 3), true);
  assert.equal(C.isDeload(m, 2), false);
  assert.equal(C.isDeload({ ...m, deload: false }, 3), false);
  assert.equal(C.isFixed(m), false);
  assert.equal(C.isFixed({ ...m, style: 'fixed' }), true);
  assert.deepEqual([0, 1, 2].map(w => C.targetRIR(m, w)), [3, 2, 0]);
  assert.equal(C.targetRIR({ weeks: 1 }, 0), 2);
});

/* ---------- plannedSets ---------- */

test('plannedSets: week value, sparse plan walks back to the last non-null, deload halves plan[0]', () => {
  const m = rpMeso();
  m.days[0].exercises[0].plan = [3, null, 5];
  assert.equal(C.plannedSets(m, 0, 0, 0), 3);
  assert.equal(C.plannedSets(m, 0, 0, 1), 3); // null → walks back
  assert.equal(C.plannedSets(m, 0, 0, 2), 5);
  assert.equal(C.plannedSets(m, 0, 0, 3), 2); // deload: round(3/2) from plan[0], not plan[2]
  m.days[0].exercises[1].plan = [1];
  assert.equal(C.plannedSets(m, 0, 1, 3), 1); // deload never below 1
  const noDeload = rpMeso({ deload: false });
  assert.equal(C.plannedSets(noDeload, 0, 0, 3), 3); // past the plan: last entry
});

/* ---------- dayOrder ---------- */

test('dayOrder: by weekday starting from day 1, array order if any weekday is null', () => {
  const days = wds => ({ days: wds.map(weekday => ({ weekday })) });
  assert.deepEqual(C.dayOrder(days([6, 3, 0])), [0, 2, 1]); // Sat, Sun, Wed
  assert.deepEqual(C.dayOrder(days([1, 3, 5])), [0, 1, 2]);
  assert.deepEqual(C.dayOrder(days([3, 1])), [0, 1]);         // Wed then Mon (next week)
  assert.deepEqual(C.dayOrder(days([6, null, 0])), [0, 1, 2]);
  assert.deepEqual(C.dayOrder(days([null, 3, 0])), [0, 1, 2]);
  assert.deepEqual(C.dayOrder({ days: [] }), []);
});

/* ---------- session ---------- */

test('session: returns existing; creates blank planned sets only with create', () => {
  const m = rpMeso();
  assert.equal(C.session(m, 0, 0), undefined);
  assert.equal(C.session(m, 0, 0, false), undefined);
  const s = C.session(m, 0, 0, true);
  assert.deepEqual(s, { date: null, done: false, slots: [
    { exId: 'a', sets: C.blankSets(3), fb: {} }, { exId: 'b', sets: C.blankSets(2), fb: {} },
  ] });
  assert.equal(C.session(m, 0, 0, true), s);
  assert.equal(C.session(m, 3, 0, true).slots[0].sets.length, 2); // deload week
});

/* ---------- advance ---------- */

test('advance: first not-done session in week/day order; complete when all done', () => {
  const m = rpMeso(); // order: day 0 (Sat), day 1 (Wed)
  C.advance(m);
  assert.deepEqual([m.pos, m.complete], [{ w: 0, d: 0 }, false]);
  m.log['0-0'] = { done: true, slots: [] };
  C.advance(m);
  assert.deepEqual(m.pos, { w: 0, d: 1 });
  m.log['0-1'] = { done: false, slots: [] }; // started but not done still blocks
  m.log['1-0'] = { done: true, slots: [] };
  C.advance(m);
  assert.deepEqual(m.pos, { w: 0, d: 1 });
  for (let w = 0; w < 4; w++) for (const d of [0, 1]) m.log[`${w}-${d}`] = { done: true, slots: [] };
  m.pos = { w: 9, d: 9 };
  C.advance(m);
  assert.equal(m.complete, true);
  assert.deepEqual(m.pos, { w: 9, d: 9 }); // pos untouched when complete
});

/* ---------- prevSlot: REMOVED in 1.4 (deliberate) ----------
   It returned the same day and slot index exactly one week back, ignoring the exercise, within one block.
   Replaced by lastPerf (lookup by exercise across all blocks); see tests/lastperf.test.js. */

/* ---------- setDelta ---------- */

test('setDelta: every rule, including the joint caps', () => {
  assert.equal(C.setDelta({}), 0);
  assert.equal(C.setDelta({ sore: 3 }), -1);
  assert.equal(C.setDelta({ work: 3 }), -1);
  assert.equal(C.setDelta({ sore: 2 }), 0);
  assert.equal(C.setDelta({ work: 2 }), 0);
  assert.equal(C.setDelta({ sore: 0, pump: 0, work: 0 }), 2);
  assert.equal(C.setDelta({ sore: 0, pump: 1, work: 0 }), 1);
  assert.equal(C.setDelta({ pump: 2 }), 1);       // defaults sore 1, work 1
  assert.equal(C.setDelta({ joint: 0 }), 1);
  assert.equal(C.setDelta({ sore: 0, pump: 0, work: 0, joint: 1 }), 0); // cap at 0
  assert.equal(C.setDelta({ sore: 3, joint: 1 }), -1);                  // min keeps -1
  assert.equal(C.setDelta({ sore: 0, pump: 0, work: 0, joint: 2 }), -1);
  assert.equal(C.FEEDBACK.map(q => q.k).join(), 'sore,pump,work,joint');
});

/* ---------- finishSession ---------- */

// Changed deliberately in 1.6: typed-but-unticked sets are KEPT (F07; the Finish sheet logs or skips them first),
// only empty unticked sets are dropped.
test('finishSession rp: base before dropping, clamp 1..12, next week reset, EMPTY unchecked dropped, done/date/advance', () => {
  const m = rpMeso();
  m.days[0].exercises.push({ exId: 'x', plan: [12], reps: null, type: 'accessory' }, { exId: 'y', plan: [1], reps: null, type: 'accessory' });
  const s = C.session(m, 0, 0, true);
  s.slots[0].sets = [set(60, 8), set(60, 8), set('', '', false)];     // base 3, one unchecked
  s.slots[0].fb = { sore: 0, pump: 0, work: 0 };                     // +2 → 5
  s.slots[1].sets = [set(10, 12), { w: '10', r: '9', done: false }]; // typed but unticked: kept since 1.6 (was dropped)
  s.slots[1].fb = { sore: 3 };                                       // -1 → 1
  s.slots[2].sets = Array.from({ length: 12 }, () => set(5, 10));
  s.slots[2].fb = { pump: 2 };                                       // 12 + 1 → clamped 12
  s.slots[3].sets = [set(5, 10)];
  s.slots[3].fb = { sore: 3 };                                       // 1 - 1 → clamped 1
  const next = C.session(m, 1, 0, true);                             // created early, untouched
  next.slots[1].sets = [set(1, 1)];                                  // has a done set → not reset

  const r = C.finishSession(m, 0, 0, s, 1234);

  assert.deepEqual(s.slots.map(sl => sl.sets.length), [2, 2, 12, 1]);
  assert.deepEqual(s.slots[1].sets[1], { w: '10', r: '9', done: false });
  assert.deepEqual(m.days[0].exercises.map(e => e.plan), [[3, 5], [2, 1], [12, 12], [1, 1]]);
  assert.deepEqual(r.changes, [{ exId: 'a', from: 3, to: 5 }, { exId: 'b', from: 2, to: 1 }]);
  assert.deepEqual(next.slots[0].sets, C.blankSets(5));
  assert.deepEqual(next.slots[1].sets, [set(1, 1)]);
  assert.deepEqual(next.slots[2].sets, C.blankSets(12));
  assert.equal(s.done, true);
  assert.equal(s.date, 1234);
  assert.deepEqual(m.pos, { w: 0, d: 1 });
});

test('finishSession rp: no plan change in the last hard week or the deload week', () => {
  for (const w of [2, 3]) {
    const m = rpMeso();
    const s = C.session(m, w, 0, true);
    s.slots.forEach(sl => { sl.sets = [set(1, 1)]; sl.fb = { pump: 2 }; });
    const r = C.finishSession(m, w, 0, s, 1);
    assert.deepEqual(r.changes, []);
    assert.deepEqual(m.days[0].exercises.map(e => e.plan), [[3], [2]]);
  }
});

test('finishSession fixed: no plan change, still drops unchecked and advances', () => {
  const m = rpMeso({ style: 'fixed' });
  const s = C.session(m, 0, 0, true);
  s.slots[0].sets = [set(60, 8), set('', '', false)];
  s.slots[0].fb = { sore: 0, pump: 0, work: 0 };
  const r = C.finishSession(m, 0, 0, s, 99);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(m.days[0].exercises.map(e => e.plan), [[3], [2]]);
  assert.deepEqual(s.slots.map(sl => sl.sets.length), [1, 0]);
  assert.deepEqual([s.done, s.date, m.pos], [true, 99, { w: 0, d: 1 }]);
});

/* ---------- allSessions / perfFor ---------- */

test('allSessions: done only, newest first, with w/d from the key', () => {
  const S = fixture();
  const all = C.allSessions(S);
  assert.equal(all.length, 5); // the unfinished 1-0 of meso 2 is excluded
  assert.deepEqual(all.map(x => x.s.date), [1760400000000, 1760300000000, 1754900000000, 1754400000000, 1754300000000]);
  assert.deepEqual([all[0].m.id, all[0].w, all[0].d], ['meso0002', 0, 1]);
});

test('perfFor: by exId across mesos, only done sets with r > 0, oldest first', () => {
  const S = fixture();
  const dips = C.perfFor(S, 'exdips01');
  assert.deepEqual(dips.map(p => p.date), [1754300000000, 1754900000000, 1760300000000]); // both mesos
  assert.equal(dips[2].sets.length, 4);
  assert.ok(!dips.some(p => p.sets.some(x => x.w === '22.5'))); // unfinished session ignored
  S.mesos[1].log['0-0'].slots[0].sets[3].r = '0';
  S.mesos[1].log['0-0'].slots[0].sets[2].done = false;
  assert.equal(C.perfFor(S, 'exdips01')[2].sets.length, 2);
  assert.deepEqual(C.perfFor(S, 'nope'), []);
  const pull = C.perfFor(S, 'expull01'); // w '0' sets still count (F02 quirk)
  assert.deepEqual(pull[0].sets.map(x => x.w), ['0', '0', '0']);
});

/* ---------- blankSession / hasLogs (1.1: sessions are created on the first write, not on view) ---------- */

test('blankSession has exactly the shape session(create) stores, and does not store it', () => {
  const m = rpMeso();
  m.days[0].exercises[0].plan = [3, null, 5];
  for (const w of [0, 1, 2, 3]) {
    const b = C.blankSession(m, w, 0);
    assert.equal(m.log[`${w}-0`], undefined);
    assert.deepEqual(C.session(m, w, 0, true), b);
  }
  assert.deepEqual(C.blankSession(m, 2, 0).slots.map(sl => sl.sets.length), [5, 2]);
  assert.deepEqual(C.blankSession(m, 3, 0).slots.map(sl => sl.sets.length), [2, 1]); // deload
});

test('hasLogs: false for no log and for empty created sessions; true once anything real exists', () => {
  const m = rpMeso();
  assert.equal(C.hasLogs(m), false);
  const s = C.session(m, 0, 0, true);
  C.session(m, 0, 1, true).slots[0].sets.push(...C.blankSets(1)); // +Set on an untouched session
  assert.equal(C.hasLogs(m), false);
  s.slots[0].sets[1].w = '60';
  assert.equal(C.hasLogs(m), true);                                // typed weight
  s.slots[0].sets[1].w = '';
  s.slots[1].sets[0].r = '8';
  assert.equal(C.hasLogs(m), true);                                // typed reps
  s.slots[1].sets[0].r = '';
  assert.equal(C.hasLogs(m), false);                               // cleared again
  s.slots[0].sets[0].done = true;
  assert.equal(C.hasLogs(m), true);                                // ticked
  const m2 = rpMeso();
  m2.log['0-0'] = { date: 1, done: true, slots: [] };              // finished with nothing kept
  assert.equal(C.hasLogs(m2), true);
  const m3 = rpMeso();
  m3.log['0-0'] = { ...C.blankSession(m3, 0, 0), skipped: true };
  assert.equal(C.hasLogs(m3), true);
  assert.equal(C.hasLogs(fixture().mesos[0]), true);
});

test('canSaveEdit: only while nothing is logged, re-checked at save time (editor open across tabs)', () => {
  const m = rpMeso();
  assert.equal(C.canSaveEdit(m), true);
  C.session(m, 0, 0, true);                     // empty session from a tap
  assert.equal(C.canSaveEdit(m), true);
  m.log['0-0'].slots[0].sets[0] = { w: '60', r: '8', done: true }; // a set ticked on Today meanwhile
  assert.equal(C.canSaveEdit(m), false);
  assert.equal(C.canSaveEdit(undefined), false); // block deleted
});

/* ---------- 1.3: set safety ---------- */

test('tickSet stamps t; ticking a done set is a no-op; untickSet clears done and t', () => {
  const st = { w: '', r: '', done: false };
  assert.equal(C.tickSet(st, { w: '60', r: '8' }, 111), true);
  assert.deepEqual(st, { w: '60', r: '8', done: true, t: 111 });
  assert.equal(C.tickSet(st, { w: '1', r: '1' }, 222), false);  // double tap
  assert.deepEqual(st, { w: '60', r: '8', done: true, t: 111 });
  C.untickSet(st);
  assert.deepEqual(st, { w: '60', r: '8', done: false });
});

test('canRemoveLastSet: only an untouched last set, never the only set', () => {
  const sl = sets => ({ sets });
  const e = () => ({ w: '', r: '', done: false });
  assert.equal(C.canRemoveLastSet(sl([e(), e()])), true);
  assert.equal(C.canRemoveLastSet(sl([e()])), false);
  assert.equal(C.canRemoveLastSet(sl([e(), { w: '60', r: '8', done: true }])), false);
  assert.equal(C.canRemoveLastSet(sl([e(), { w: '60', r: '', done: false }])), false);
  assert.equal(C.canRemoveLastSet(sl([e(), { w: '', r: '8', done: false }])), false);
  assert.equal(C.canRemoveLastSet(sl([{ w: '60', r: '8', done: true }, e()])), true);
});

/* ---------- 1.5: finished workouts are read-only ---------- */

test('canWrite: finished needs a matching Edit key; unfinished and missing sessions are always writable', () => {
  const done = { done: true, date: 1, slots: [] }, open = { done: false, date: null, slots: [] };
  assert.equal(C.canWrite(done, 'm:0-0', null), false);
  assert.equal(C.canWrite(done, 'm:0-0', 'm:0-0'), true);
  assert.equal(C.canWrite(done, 'm:0-0', 'm:1-0'), false);
  assert.equal(C.canWrite(done, 'm:0-0', 'other:0-0'), false);
  assert.equal(C.canWrite(open, 'm:0-0', null), true);
  assert.equal(C.canWrite(open, 'm:0-0', 'm:1-0'), true);
  assert.equal(C.canWrite(undefined, 'm:0-0', null), true); // virtual session: first write creates it
});

test('tidySlots: drops trailing empty unticked sets after editing, keeps ≥1, never touches done/typed', () => {
  const e = () => ({ w: '', r: '', done: false });
  const s = { done: true, slots: [
    { sets: [{ w: '60', r: '8', done: true }, e(), e()] },          // → 1
    { sets: [e(), e()] },                                            // → keeps 1
    { sets: [] },                                                    // stays empty
    { sets: [{ w: '60', r: '8', done: true }, e(), { w: '62', r: '', done: false }] }, // typed last: untouched
    { sets: [e(), { w: '50', r: '5', done: true }, { w: ' ', r: '', done: false }] },  // whitespace counts as empty
  ] };
  assert.equal(C.tidySlots(s), 4);
  assert.deepEqual(s.slots.map(sl => sl.sets.length), [1, 1, 0, 3, 2]);
  assert.equal(C.tidySlots(s), 0);
});
