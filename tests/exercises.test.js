'use strict';
// 1.9: the delete guard covers history (C9), and rename keeps the id.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../core.js');

const fixture = () => { const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'v1-sample.json'), 'utf8')); C.normalize(s); return s; };

test('exerciseUse: plans by block name, logged sets and sessions across all blocks', () => {
  const S = fixture();
  assert.deepEqual(C.exerciseUse(S, 'exdips01'), { inPlans: ['Block 1', 'My plan · 3 days'], loggedSets: 11, sessions: 4 }); // 2+3+4 done, +1 done +1 typed in the open session
  assert.deepEqual(C.exerciseUse(S, 'nope'), { inPlans: [], loggedSets: 0, sessions: 0 });
});

test('exerciseUse sees history that no plan references any more (e.g. after a swap)', () => {
  const S = fixture();
  S.mesos[0].log['0-0'].slots[1].exId = 'goblet';             // logged under another exercise that day
  const u = C.exerciseUse(S, 'goblet');
  assert.deepEqual(u, { inPlans: [], loggedSets: 2, sessions: 1 });
  assert.equal(C.canDeleteExercise(u), false);
});

test('exerciseUse counts a session slot even with only blank sets (would be orphaned)', () => {
  const S = fixture();
  S.mesos[1].log['1-0'].slots[1].exId = 'blankonly';
  const u = C.exerciseUse(S, 'blankonly');
  assert.deepEqual([u.loggedSets, u.sessions], [0, 1]);
  assert.equal(C.canDeleteExercise(u), false);
  assert.equal(C.canDeleteExercise({ inPlans: [], loggedSets: 0, sessions: 0 }), true);
  assert.equal(C.canDeleteExercise({ inPlans: ['X'], loggedSets: 0, sessions: 0 }), false);
});

test('renameExercise: trims, keeps the id, refuses empty and duplicates (case-insensitive)', () => {
  const S = fixture();
  assert.deepEqual(C.renameExercise(S, 'exsqat01', '  Back Squat  '), { ok: true });
  const ex = S.exercises.find(e => e.id === 'exsqat01');
  assert.equal(ex.name, 'Back Squat');
  assert.deepEqual(C.renameExercise(S, 'exsqat01', '   '), { error: 'empty' });
  assert.deepEqual(C.renameExercise(S, 'exsqat01', 'hammer curl'), { error: 'duplicate' });
  assert.equal(ex.name, 'Back Squat');
  assert.deepEqual(C.renameExercise(S, 'exsqat01', 'back squat'), { ok: true }); // its own name, new case
  assert.deepEqual(C.renameExercise(S, 'nope', 'X'), { error: 'missing' });
  assert.equal(C.lastPerf(S, 'exsqat01').sets.length, 4);       // history still found by id
});
