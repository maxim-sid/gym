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
  assert.ok(created.includes('Tuck Front Lever'));                        // new names start fresh
  assert.equal(S.exercises.filter(e => lc(e.name) === 'squat').length, 1);
});

test('plan.js: every link has a following exercise on the same day; the supersets are as planned', () => {
  PLAN.days.forEach(d => d.exercises.forEach((e, i) => {
    if (e.link) assert.ok(i + 1 < d.exercises.length, `${d.name}: ${e.name} links to nothing`);
  }));
  const pairs = PLAN.days.flatMap(d => d.exercises.map((e, i) => (e.link ? `${e.name} + ${d.exercises[i + 1].name}` : null)).filter(Boolean));
  assert.deepEqual(pairs, ['Rising (radial deviation) + Dumbbell Lateral Raise', 'Leg Curl + Calf Raise', 'Reverse Curl + Rope Pushdown',
    'Face Pull + Cable External Rotation']);
  const m = { days: PLAN.days.map(d => ({ exercises: d.exercises.map(e => ({ link: e.link })) })) };
  assert.deepEqual(C.groups(m, 0).filter(g => g.length > 1).map(g => g.map(i => PLAN.days[0].exercises[i].name)),
    [['Rising (radial deviation)', 'Dumbbell Lateral Raise']]);
});

test('reused names resolve to the exercises a phone already has from the old plan (history carries over)', () => {
  // Exercises a phone already has from the previous plan (data/plan.js at 18d9563), spelled exactly as there.
  // Hardcoded so the test needs no git history.
  const OLD = [['Dumbbell Lateral Raise', 'Shoulders'], ['Rope Pushdown', 'Triceps'], ['Leg Curl', 'Hamstrings'], ['Calf Raise', 'Calves']];
  const S = { exercises: OLD.map(([name, muscle], k) => ({ id: `old${k}`, name, muscle })), mesos: [] };
  const ids = new Map(S.exercises.map(e => [e.name, e.id]));
  for (const name of ['Dumbbell Lateral Raise', 'Rope Pushdown', 'Leg Curl', 'Calf Raise']) {
    const e = all.find(x => x.name === name);
    assert.ok(e, `${name} is in the plan`);
    assert.equal(C.resolveExercise(S, e.name, e.was).ex?.id, ids.get(name), name);
  }
});
