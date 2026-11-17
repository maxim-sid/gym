'use strict';
// 3.7: plan.js `was` aliases rename an existing exercise in place (same id, history kept).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const S = () => ({ exercises: [
  { id: 'sq', name: 'Squat (barbell or goblet)', muscle: 'Quads' },
  { id: 'lp', name: 'Lat Pulldown or Cable Row', muscle: 'Back' },
  { id: 'bs', name: 'Back Squat', muscle: 'Quads' },
], mesos: [] });

test('found by name: as is, no rename', () => {
  const s = S();
  assert.deepEqual(C.resolveExercise(s, 'back squat', ['Squat (barbell or goblet)']), { ex: s.exercises[2] });
  assert.equal(s.exercises[0].name, 'Squat (barbell or goblet)');      // the new name exists: no rename
});

test('found by an alias: renamed in place, same id; case-insensitive; first matching alias', () => {
  const s = S();
  const r = C.resolveExercise(s, 'Lat Pulldown', ['nope', 'LAT PULLDOWN OR CABLE ROW']);
  assert.equal(r.ex.id, 'lp');
  assert.equal(r.renamedFrom, 'LAT PULLDOWN OR CABLE ROW');
  assert.equal(s.exercises[1].name, 'Lat Pulldown');
  assert.equal(C.resolveExercise(s, 'Lat Pulldown', ['Lat Pulldown or Cable Row']).ex.id, 'lp'); // idempotent
});

test('no name, no alias match: null (the caller creates it)', () => {
  const s = S();
  assert.deepEqual(C.resolveExercise(s, 'Goblet Squat', ['Something else']), { ex: null });
  assert.deepEqual(C.resolveExercise(s, 'Goblet Squat'), { ex: null });
  assert.equal(s.exercises.length, 3);
});
