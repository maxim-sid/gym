'use strict';
// The plan in data/plan.js: well-formed, and its `was` aliases rename old exercises in place.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../core.js');

const root = path.join(__dirname, '..');
const PLAN = JSON.parse(JSON.stringify(vm.runInNewContext(`${fs.readFileSync(path.join(root, "data/plan.js"), "utf8")};MY_PLAN`))); // into this realm
const MUSCLES = vm.runInNewContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8').match(/const MUSCLES = (\[[^\]]*\]);/)[1]);
const all = PLAN.days.flatMap(d => d.exercises);
const lc = s => s.toLowerCase();

test('plan.js: valid muscles, sets and rep ranges, types', () => {
  all.forEach(e => {
    assert.ok(MUSCLES.includes(e.muscle), `${e.name}: muscle ${e.muscle}`);
    assert.ok(Number.isInteger(e.sets) && e.sets >= 1, `${e.name}: sets`);
    assert.ok(Array.isArray(e.reps) && e.reps[0] >= 1 && e.reps[0] <= e.reps[1], `${e.name}: reps ${e.reps}`);
    assert.ok(['main', 'accessory'].includes(e.type), `${e.name}: type`);
  });
});

test('plan.js: no duplicate names; no alias collides with a name or another alias; unique weekdays', () => {
  const names = all.map(e => lc(e.name));
  assert.equal(new Set(names).size, names.length);
  const aliases = all.flatMap(e => (e.was || []).map(lc));
  assert.equal(new Set(aliases).size, aliases.length);
  aliases.forEach(a => assert.ok(!names.includes(a), `alias ${a} is also a name`));
  const wd = PLAN.days.map(d => d.weekday);
  assert.equal(new Set(wd).size, wd.length);
  wd.forEach(x => assert.ok(Number.isInteger(x) && x >= 0 && x <= 6));
});

test('plan.js: day order follows Day 1 (Sat, Sun, Tue, Wed, Fri)', () => {
  assert.deepEqual(C.dayOrder(PLAN).map(i => PLAN.days[i].weekday), [6, 0, 2, 3, 5]);
  assert.deepEqual(C.dayOrder(PLAN), [0, 1, 2, 3, 4]);
});

test('applying the plan to the fixture renames "Squat (barbell or goblet)" to "Squat", keeping its id', () => {
  const S = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'v1-sample.json'), 'utf8'));
  C.normalize(S);
  const before = S.exercises.find(e => e.name === 'Squat (barbell or goblet)');
  const n = S.exercises.length;
  const created = [];
  all.forEach(e => { if (!C.resolveExercise(S, e.name, e.was).ex) created.push(e.name); });
  const after = S.exercises.find(e => e.id === before.id);
  assert.equal(after.name, 'Squat');
  assert.equal(S.exercises.length, n);                                    // renamed, not added
  assert.ok(!created.includes('Squat'));
  assert.ok(created.includes('Bench Press'));                             // new names start fresh
  assert.equal(S.exercises.filter(e => lc(e.name) === 'squat').length, 1);
});
