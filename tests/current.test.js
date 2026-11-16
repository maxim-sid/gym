'use strict';
// 2.6: which card is expanded (the current one).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const done = (t) => ({ w: '60', r: '8', done: true, ...(t != null ? { t } : {}) });
const open = () => ({ w: '', r: '', done: false });
const sk = () => ({ w: '', r: '', done: false, skip: true });
const S = (...slots) => ({ slots: slots.map(sets => (Array.isArray(sets) ? { sets } : sets)) });

test('currentSlot: nothing ticked → the first slot with work', () => {
  assert.equal(C.currentSlot(S([open()], [open()])), 0);
  assert.equal(C.currentSlot(S([done(1)], [open()])), 1);
});

test('currentSlot: the slot of the latest tick while it still has work (logging out of order)', () => {
  assert.equal(C.currentSlot(S([open(), open()], [done(5), open()], [open()])), 1);
  assert.equal(C.currentSlot(S([done(9), open()], [done(5), open()])), 0);
});

test('currentSlot: latest slot finished → the first slot with work, even an earlier one', () => {
  assert.equal(C.currentSlot(S([open()], [done(5), done(6)], [open()])), 0);
});

test('currentSlot: skipped sets/slots have no work; done sets without t are ignored for "latest"', () => {
  assert.equal(C.currentSlot(S([sk(), done(1)], { skip: true, sets: [open()] }, [open()])), 2);
  assert.equal(C.currentSlot(S([done(), open()], [done(3), open()])), 1);
  assert.equal(C.currentSlot(S([done(1)], [sk()])), -1);
  assert.equal(C.currentSlot(S()), -1);
});
