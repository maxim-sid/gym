'use strict';
// 3.5 follow-up: a waiting update reloads the page only when nothing is in progress.
const test = require('node:test');
const assert = require('node:assert/strict');
const { canAutoUpdate } = require('../core.js');

test('canAutoUpdate: idle app may reload', () => {
  assert.equal(canAutoUpdate({ rest: false, focused: false, sheet: false, edit: false }), true);
  assert.equal(canAutoUpdate({}), true);
});

test('canAutoUpdate: any in-progress state blocks the reload', () => {
  for (const k of ['rest', 'focused', 'sheet', 'edit']) {
    assert.equal(canAutoUpdate({ rest: false, focused: false, sheet: false, edit: false, [k]: true }), false, k);
  }
});
