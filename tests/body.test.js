'use strict';
// 3.8: the Body log (S.body) and how bodyweight feeds the bodyweight-exercise charts and records.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const st = (body, settings = {}) => ({ v: 1, settings: { unit: 'kg', restMain: 180, restAcc: 90, beepLoud: false, keepAwake: false, ...settings }, exercises: [], mesos: [], ...(body ? { body } : {}) });

test('addBody: one entry per date (replaces), sorted, comma decimals, 0–1000; removeBody', () => {
  const S = st();
  assert.deepEqual(C.addBody(S, '2026-11-10', '82,5'), { ok: true, prev: null });
  C.addBody(S, '2026-11-03', 83);
  assert.deepEqual(C.addBody(S, '2026-11-10', '82.0'), { ok: true, prev: { d: '2026-11-10', w: '82.5' } });
  assert.deepEqual(S.body, [{ d: '2026-11-03', w: '83' }, { d: '2026-11-10', w: '82' }]);
  assert.deepEqual(C.addBody(S, '2026-13-01', 80), { error: 'date' });
  assert.deepEqual(C.addBody(S, '2026-11-11', '0'), { error: 'weight' });
  assert.deepEqual(C.addBody(S, '2026-11-11', '1000'), { error: 'weight' });
  assert.deepEqual(C.addBody(S, '2026-11-11', 'x'), { error: 'weight' });
  assert.deepEqual(C.removeBody(S, '2026-11-03'), { d: '2026-11-03', w: '83' });
  C.removeBody(S, '2026-11-10');
  assert.equal('body' in S, false);
  assert.equal(C.removeBody(S, '2026-11-10'), null);
});

test('bodyAt: the latest entry on or before a date or timestamp; currentBody falls back to the setting', () => {
  const S = st([{ d: '2026-11-01', w: '84' }, { d: '2026-11-08', w: '83' }], { bodyweight: 90 });
  assert.equal(C.bodyAt(S, '2026-10-31'), null);
  assert.equal(C.bodyAt(S, '2026-11-01'), 84);
  assert.equal(C.bodyAt(S, '2026-11-07'), 84);
  assert.equal(C.bodyAt(S, new Date(2026, 10, 20, 9).getTime()), 83);
  assert.equal(C.currentBody(S), 83);
  assert.equal(C.currentBody(st(null, { bodyweight: 90 })), 90);
  assert.equal(C.currentBody(st()), null);
  assert.equal(C.bodyFor(S, '2026-10-01'), 83);                          // before the log: the current value
});

test('bodyStats: latest, 7-day average, change vs the 7 days ending 4 weeks earlier; null without data', () => {
  assert.deepEqual(C.bodyStats(st(), '2026-11-17'), { latest: null, avg7: null, change: null });
  const S = st([{ d: '2026-10-14', w: '85' }, { d: '2026-10-18', w: '84' }, { d: '2026-11-12', w: '83' }, { d: '2026-11-16', w: '82' }]);
  const r = C.bodyStats(S, '2026-11-17');
  assert.deepEqual(r.latest, { d: '2026-11-16', w: '82' });
  assert.equal(r.avg7, 82.5);                                             // 11-11..11-17: 83, 82
  assert.equal(C.bodyStats(S, '2026-11-19').avg7, 82);                   // 11-13..11-19: 82
  assert.equal(r.change, -2);                                             // then 10-14..10-20: 85, 84 → 84.5
  assert.equal(C.bodyStats(st([{ d: '2026-11-16', w: '82' }]), '2026-11-17').change, null);
});

test('normalize: malformed body entries are dropped (not the file); idempotent', () => {
  const s = st([{ d: '2026-11-02', w: '82' }, { d: 'bad', w: '80' }, { d: '2026-11-01', w: '-3' }, null, { d: '2026-11-01', w: '81,5' }]);
  C.normalize(s);
  assert.deepEqual(s.body, [{ d: '2026-11-01', w: '81.5' }, { d: '2026-11-02', w: '82' }]);
  assert.equal(C.normalize(s), false);
  const t = st('nope');
  C.normalize(t);
  assert.equal('body' in t, false);
  const r = C.loadFrom(JSON.stringify(st([{ d: 'x' }])));
  assert.ok(r.state);
  assert.equal('body' in r.state, false);
});

test('bodyweight exercise charts and records use s.bw, then the log on that day, then the current value', () => {
  const ex = { id: 'dip', bw: true };
  const set = (w, r) => ({ w, r, done: true });
  const day = (y, m, d) => new Date(y, m - 1, d, 10).getTime();
  const S = st([{ d: '2026-10-01', w: '90' }]);
  S.exercises = [ex];
  S.mesos = [{ id: 'm', weeks: 9, deload: false, days: [], log: {
    '0-0': { date: day(2026, 10, 2), done: true, slots: [{ exId: 'dip', sets: [set('', '10')] }] },           // log: 90
    '1-0': { date: day(2026, 10, 9), done: true, bw: 88, slots: [{ exId: 'dip', sets: [set('', '10')] }] },   // saved: 88
  } }];
  let r = C.chartPoints(S, ex);
  assert.equal(r.metric, 'e1rmBw');
  assert.equal(r.fallback, false);
  assert.deepEqual(r.points.map(p => Math.round(p.y)), [Math.round(C.e1rm(90, 10)), Math.round(C.e1rm(88, 10))]);
  delete S.body;                                                          // no log, no setting: as before 3.1
  assert.equal(C.chartPoints(S, ex).metric, 'reps');                      // (never loaded → best reps)
  S.settings.bodyweight = 80;                                             // setting only: the old workout falls back
  r = C.chartPoints(S, ex);
  assert.equal(r.fallback, true);
  assert.equal(Math.round(r.points[0].y), Math.round(C.e1rm(80, 10)));
});

test('saveBody: editing an entry under a new date moves it; Undo restores the original and anything replaced', () => {
  const S = st([{ d: '2026-11-01', w: '84' }, { d: '2026-11-03', w: '83' }]);
  let r = C.saveBody(S, '2026-11-02', '83.5', { orig: '2026-11-01', today: '2026-11-17' });
  assert.deepEqual(S.body, [{ d: '2026-11-02', w: '83.5' }, { d: '2026-11-03', w: '83' }]);
  C.undoBodySave(S, r);
  assert.deepEqual(S.body, [{ d: '2026-11-01', w: '84' }, { d: '2026-11-03', w: '83' }]);
  r = C.saveBody(S, '2026-11-03', '82', { orig: '2026-11-01', today: '2026-11-17' });   // onto an existing day
  assert.deepEqual(S.body, [{ d: '2026-11-03', w: '82' }]);
  C.undoBodySave(S, r);
  assert.deepEqual(S.body, [{ d: '2026-11-01', w: '84' }, { d: '2026-11-03', w: '83' }]);
  r = C.saveBody(S, '2026-11-01', '85', { orig: '2026-11-01', today: '2026-11-17' });   // same day: a plain edit
  assert.equal(r.orig, null);
  assert.equal(S.body.length, 2);
});

test('addBody / saveBody refuse a date after today', () => {
  const S = st();
  assert.deepEqual(C.addBody(S, '2026-11-18', '80', '2026-11-17'), { error: 'future' });
  assert.deepEqual(C.saveBody(S, '2026-11-18', '80', { today: '2026-11-17' }), { error: 'future' });
  assert.ok(C.addBody(S, '2026-11-17', '80', '2026-11-17').ok);
  assert.equal(S.body.length, 1);
});

test('bwFor order: an entry on exactly that day, then s.bw, then the latest before, then current', () => {
  const day = d => new Date(2026, 10, d, 9).getTime();
  const S = st([{ d: '2026-11-05', w: '81' }, { d: '2026-11-10', w: '80' }]);
  assert.equal(C.bwFor(S, { date: day(10), bw: 99 }), 80);                // exact day beats the snapshot
  assert.equal(C.bwFor(S, { date: day(8), bw: 99 }), 99);                 // then the snapshot
  assert.equal(C.bwFor(S, { date: day(8) }), 81);                         // then the latest before
  assert.equal(C.bwFor(S, { date: day(1) }), 80);                         // then current
});
