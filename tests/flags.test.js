'use strict';
// 1.2: bodyweight/timed flags, the weight rule on ✓, set display and the progress chart.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../core.js');

const RAW = fs.readFileSync(path.join(__dirname, 'fixtures', 'v1-sample.json'), 'utf8');
const fixture = () => { const s = JSON.parse(RAW); C.normalize(s); return s; };
const byName = (s, n) => s.exercises.find(e => e.name === n);

/* ---------- seeds ---------- */

test('normalize seeds bw by exact name and timed from plan slots', () => {
  const s = fixture();
  assert.equal(byName(s, 'Weighted Dips').bw, true);
  assert.equal(byName(s, 'Weighted Pull-up').bw, true);
  assert.equal(byName(s, 'Hammer Curl').bw, false);
  assert.equal(byName(s, 'Static Hold (mid-range curl or band/cable pull)').timed, true);
  assert.equal(byName(s, 'Weighted Dips').timed, false);
});

test('bw seed matches exact names only', () => {
  const s = { v: 1, exercises: ['Dip', 'dip', 'Weighted Dip', 'Pull-ups', 'Push-up', 'Ab Wheel', 'Chin-up'].map((name, i) => ({ id: 'e' + i, name, muscle: 'Chest' })), mesos: [] };
  C.normalize(s);
  assert.deepEqual(s.exercises.map(e => e.bw), [true, false, false, false, true, true, false]);
});

test('a flag the user set (including false) survives normalize', () => {
  const s = fixture();
  byName(s, 'Weighted Dips').bw = false;
  byName(s, 'Hammer Curl').bw = true;
  byName(s, 'Static Hold (mid-range curl or band/cable pull)').timed = false;
  assert.equal(C.normalize(s), false);
  assert.equal(byName(s, 'Weighted Dips').bw, false);
  assert.equal(byName(s, 'Hammer Curl').bw, true);
  assert.equal(byName(s, 'Static Hold (mid-range curl or band/cable pull)').timed, false);
});

test('freshState exercises are already seeded (no backup-auto churn on the next launch)', () => {
  const f = C.freshState();
  assert.equal(C.normalize(f), false);
  assert.deepEqual(f.exercises.filter(e => e.bw).map(e => e.name).sort(), ['Dip', 'Hanging Leg Raise', 'Pull-up']);
});

test('seeding counts as a change: loadState writes backup-auto with the raw data', () => {
  const s = JSON.parse(RAW); C.normalize(s);
  s.exercises.forEach(e => { delete e.bw; delete e.timed; }); // as stored by the previous version
  const raw = JSON.stringify(s);
  const writes = {};
  const st = { length: 0, key: () => null, getItem: k => (k === C.KEY ? raw : null), setItem: (k, v) => { writes[k] = v; } };
  const r = C.loadState(st, 0);
  assert.equal(r.mode, 'ok');
  assert.deepEqual(Object.keys(writes), [C.BACKUP_KEY]);
  assert.equal(writes[C.BACKUP_KEY], raw);
});

/* ---------- acceptSet (weight rule) ---------- */

const bw = { bw: true }, lift = { bw: false };
const blank = { w: '', r: '' };

test('acceptSet: typed values win; prefill fills blanks', () => {
  assert.deepEqual(C.acceptSet({ w: '60', r: '8' }, { w: '50', r: '5' }, lift), { ok: true, w: '60', r: '8' });
  assert.deepEqual(C.acceptSet(blank, { w: '50', r: '5' }, lift), { ok: true, w: '50', r: '5' });
  assert.deepEqual(C.acceptSet({ w: '', r: '6' }, { w: 52.5, r: '' }, lift), { ok: true, w: '52.5', r: '6' });
});

test('acceptSet: blank weight is refused for a weighted lift, never turned into 0', () => {
  assert.deepEqual(C.acceptSet({ w: '', r: '8' }, blank, lift), { error: 'weight' });
  assert.deepEqual(C.acceptSet({ w: '', r: '8' }, { w: '0', r: '' }, lift), { error: 'weight' }); // suggested 0 = none
  assert.deepEqual(C.acceptSet({ w: '', r: '8' }, blank, undefined), { error: 'weight' });
  assert.deepEqual(C.acceptSet({ w: 'abc', r: '8' }, blank, lift), { error: 'weight' });
});

test('acceptSet: bodyweight blank stays blank; explicit 0 is kept as typed', () => {
  assert.deepEqual(C.acceptSet({ w: '', r: '8' }, blank, bw), { ok: true, w: '', r: '8' });
  assert.deepEqual(C.acceptSet({ w: '', r: '8' }, { w: 0, r: '' }, bw), { ok: true, w: '', r: '8' });
  assert.deepEqual(C.acceptSet({ w: '0', r: '8' }, blank, lift), { ok: true, w: '0', r: '8' });
  assert.deepEqual(C.acceptSet({ w: '0', r: '8' }, blank, bw), { ok: true, w: '0', r: '8' });
  assert.deepEqual(C.acceptSet({ w: '', r: '6' }, { w: '20', r: '' }, bw), { ok: true, w: '20', r: '6' });
});

test('acceptSet: reps must be more than 0', () => {
  assert.deepEqual(C.acceptSet({ w: '60', r: '' }, blank, lift), { error: 'reps' });
  assert.deepEqual(C.acceptSet({ w: '60', r: '0' }, blank, lift), { error: 'reps' });
  assert.deepEqual(C.acceptSet({ w: '60', r: '' }, { w: '', r: '0' }, lift), { error: 'reps' });
  assert.deepEqual(C.acceptSet({ w: '', r: '' }, blank, bw), { error: 'reps' });
  assert.deepEqual(C.acceptSet({ w: '', r: '' }, blank, lift), { error: 'weight' }); // weight is asked first
});

/* ---------- fmtSets ---------- */

test('fmtSets: weighted, bodyweight, timed and legacy 0', () => {
  const s = (w, r) => ({ w, r, done: true });
  assert.equal(C.fmtSets([s('100', '8'), s('97.5', '7')], lift, 'kg'), '100×8, 97.5×7');
  assert.equal(C.fmtSets([s('0', '8'), s('', '6')], lift, 'kg'), '8 reps, 6 reps');   // old data, unchanged
  assert.equal(C.fmtSets([s('', '8'), s('0', '7'), s('20', '6')], bw, 'kg'), 'BW×8, BW×7, +20×6');
  assert.equal(C.fmtSets([s('', '30'), s('10', '25')], { timed: true }, 'kg'), '30 s, +10 kg · 25 s');
  assert.equal(C.fmtSets([s('', '30')], { timed: true, bw: true }, 'lb'), '30 s');
  assert.equal(C.fmtSets([], lift, 'kg'), '');
});

/* ---------- chartPoints ---------- */

function stateWith(sessions, ex) {
  return { exercises: [ex], mesos: [{ days: [], log: Object.fromEntries(sessions.map((sets, i) =>
    [`${i}-0`, { date: 1000 + i, done: true, slots: [{ exId: ex.id, sets: sets.map(([w, r]) => ({ w, r, done: true })) }] }])) }] };
}

test('chartPoints weighted: e1RM from loaded sets of 1–12 reps; sessions without one are omitted', () => {
  const ex = { id: 'sq', bw: false, timed: false };
  const S = stateWith([[['100', '8']], [['0', '8']], [['100', '15']], [['', '5'], ['110', '5']]], ex);
  const r = C.chartPoints(S, ex);
  assert.equal(r.metric, 'e1rm');
  assert.deepEqual(r.points.map(p => p.x), [1000, 1003]);           // the 0-weight and 15-rep sessions are gone
  assert.deepEqual(r.points.map(p => +p.y.toFixed(2)), [126.67, 128.33]);
  assert.ok(r.points.every(p => p.y > 0));
});

test('chartPoints: a lift never logged with a weight falls back to best reps', () => {
  const ex = { id: 'pu', bw: false, timed: false };
  const r = C.chartPoints(stateWith([[['0', '12']], [['', '15']]], ex), ex);
  assert.deepEqual([r.metric, r.points.map(p => p.y)], ['reps', [12, 15]]);
});

test('chartPoints bodyweight: best added load; best reps if never loaded', () => {
  const ex = { id: 'dip', bw: true, timed: false };
  const r = C.chartPoints(stateWith([[['15', '8'], ['20', '5']], [['', '12']], [['22.5', '6']]], ex), ex);
  assert.deepEqual([r.metric, r.points.map(p => p.y)], ['load', [20, 0, 22.5]]);
  const r2 = C.chartPoints(stateWith([[['', '8']], [['0', '10']]], ex), ex);
  assert.deepEqual([r2.metric, r2.points.map(p => p.y)], ['reps', [8, 10]]);
});

test('chartPoints timed: longest hold in seconds, no e1RM even with a load', () => {
  const ex = { id: 'hold', bw: false, timed: true };
  const r = C.chartPoints(stateWith([[['', '30'], ['10', '25']], [['10', '35']]], ex), ex);
  assert.deepEqual([r.metric, r.points.map(p => p.y)], ['hold', [30, 35]]);
});

test('chartPoints on the fixture: the timed Static Hold uses seconds', () => {
  const s = fixture();
  const r = C.chartPoints(s, byName(s, 'Static Hold (mid-range curl or band/cable pull)'));
  assert.deepEqual([r.metric, r.points.map(p => p.y)], ['hold', [30]]);
});

/* ---------- review fix: band exercises, whitespace ---------- */

test('band exercises seed to bodyweight by exact name', () => {
  const names = ['Finger Extension (band)', 'Static Hold (mid-range curl or band/cable pull)', 'Finger Extension'];
  const s = { v: 1, exercises: names.map((name, i) => ({ id: 'b' + i, name, muscle: 'Forearms' })), mesos: [] };
  C.normalize(s);
  assert.deepEqual(s.exercises.map(e => e.bw), [true, true, false]);
  assert.equal(byName(fixture(), 'Static Hold (mid-range curl or band/cable pull)').bw, true);
});

test('acceptSet: a band exercise accepts a blank weight; whitespace counts as blank', () => {
  const band = { bw: true, timed: false };
  assert.deepEqual(C.acceptSet({ w: '', r: '15' }, blank, band), { ok: true, w: '', r: '15' });
  assert.deepEqual(C.acceptSet({ w: ' ', r: ' 15 ' }, blank, band), { ok: true, w: '', r: '15' });
  assert.deepEqual(C.acceptSet({ w: '  ', r: '8' }, blank, lift), { error: 'weight' });
  assert.deepEqual(C.acceptSet({ w: ' ', r: '8' }, { w: '50', r: '' }, lift), { ok: true, w: '50', r: '8' });
  assert.deepEqual(C.acceptSet({ w: '60', r: ' ' }, blank, lift), { error: 'reps' });
});

test('chartPoints bodyweight with a bodyweight: e1RM of bodyweight + added load; s.bw per workout, else the setting', () => {
  const ex = { id: 'dip', bw: true, timed: false };
  const S = stateWith([[['', '10']], [['20', '6'], ['', '15']]], ex);
  S.settings = { bodyweight: 80 };
  let r = C.chartPoints(S, ex);
  assert.equal(r.metric, 'e1rmBw');
  assert.equal(r.fallback, true);
  assert.deepEqual(r.points.map(p => Math.round(p.y)), [Math.round(C.e1rm(80, 10)), Math.round(C.e1rm(100, 6))]); // 15 reps: out
  const ms = S.mesos[0];
  Object.values(ms.log).forEach(s => { s.bw = 75; });                     // saved with each workout
  r = C.chartPoints(S, ex);
  assert.equal(r.fallback, false);
  assert.equal(Math.round(r.points[0].y), Math.round(C.e1rm(75, 10)));
  delete S.settings.bodyweight;                                           // setting cleared: saved values still count
  assert.equal(C.chartPoints(S, ex).metric, 'e1rmBw');
  Object.values(ms.log).forEach(s => { delete s.bw; });
  assert.equal(C.chartPoints(S, ex).metric, 'load');                      // no bodyweight anywhere: as before
});
