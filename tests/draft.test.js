'use strict';
// 3.6: the saved builder draft, and the backup reminder.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const D = 864e5;
const S0 = () => ({ settings: {}, exercises: [{ id: 'a' }, { id: 'b' }], mesos: [{ id: 'm1', weeks: 4, deload: false, days: [], log: {} }] });

test('parseDraft: a valid draft comes back; gone exercises are dropped; an edit of a gone block becomes new', () => {
  const draft = { editId: 'm1', name: 'Block 2', weeks: 4, deload: true, style: 'rp', days: [{ name: 'Day 1', exercises: [
    { exId: 'a', plan: [2], reps: null, type: 'main' }, { exId: 'zz', plan: [2] }, { exId: 'b', plan: [3] }] }] };
  let r = C.parseDraft(JSON.stringify(draft), S0());
  assert.deepEqual(r.days[0].exercises.map(x => x.exId), ['a', 'b']);
  assert.equal(r.editId, 'm1');
  const S = S0(); S.mesos = [];
  r = C.parseDraft(JSON.stringify(draft), S);
  assert.equal('editId' in r, false);
});

test('parseDraft: anything unreadable or not a draft → null', () => {
  for (const raw of [null, '', '{', '[]', '{"name":1,"weeks":4,"days":[]}', '{"name":"x","weeks":0,"days":[]}', '{"name":"x","weeks":4,"days":[{}]}']) {
    assert.equal(C.parseDraft(raw, S0()), null, String(raw));
  }
});

test('backupDue: after 14 days with workouts; from the first workout if never exported; dismissed until the next export', () => {
  const now = 100 * D;
  const S = S0();
  assert.equal(C.backupDue(S, now), null);                                       // no workouts
  S.mesos[0].log['0-0'] = { date: now - 20 * D, done: true, slots: [] };
  assert.deepEqual(C.backupDue(S, now), { days: 20 });                          // never exported: since the first workout
  S.settings.lastExport = now - 10 * D;
  assert.equal(C.backupDue(S, now), null);
  assert.deepEqual(C.backupDue(S, now + 11 * D), { days: 21 });
  S.settings.backupHintOff = S.settings.lastExport;                             // dismissed
  assert.equal(C.backupDue(S, now + 11 * D), null);
  S.settings.lastExport = now + 11 * D;                                         // a new export
  assert.deepEqual(C.backupDue(S, now + 30 * D), { days: 19 });                 // due again later
  const N = S0(); N.mesos[0].log['0-0'] = { date: now - 20 * D, done: true, slots: [] }; N.settings.backupHintOff = 0;
  assert.equal(C.backupDue(N, now), null);                                      // never exported, dismissed
});
