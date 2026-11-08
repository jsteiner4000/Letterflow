const { test, expect } = require('@playwright/test');
const { createHotkeyMachine } = require('../../src/main/hotkey-machine');

const key = (k, down) => ({ ev: 'key', key: k, down });
const feedAll = (m, evs) => evs.map((e) => m.feed(e));

test('Strg+Win drücken und loslassen', () => {
  const m = createHotkeyMachine('ctrl+win');
  expect(feedAll(m, [key('lctrl', true), key('lwin', true), key('lwin', false)])).toEqual([
    null,
    'down',
    'up',
  ]);
});

test('Reihenfolge egal (Win zuerst)', () => {
  const m = createHotkeyMachine('ctrl+win');
  expect(feedAll(m, [key('rwin', true), key('rctrl', true), key('rwin', false)])).toEqual([
    null,
    'down',
    'up',
  ]);
});

test('andere Taste bricht ab', () => {
  const m = createHotkeyMachine('ctrl+win');
  const evs = [key('lctrl', true), key('lwin', true), { ev: 'other' }, key('lwin', false)];
  expect(feedAll(m, evs)).toEqual([null, 'down', 'cancel', null]);
});

test('Strg+Umschalt+Win startet kein Diktat für ctrl+win', () => {
  const m = createHotkeyMachine('ctrl+win');
  const evs = [key('lctrl', true), key('lshift', true), key('lwin', true), key('lshift', false)];
  expect(feedAll(m, evs)).toEqual([null, null, null, null]);
});

test('fremde Modifier-Taste während des Haltens bricht ab', () => {
  const m = createHotkeyMachine('ctrl+win');
  const evs = [key('lctrl', true), key('lwin', true), key('lshift', true), key('lshift', false)];
  expect(feedAll(m, evs)).toEqual([null, 'down', 'cancel', null]);
});

test('nach Abbruch kein up und erst nach vollständigem Loslassen wieder bereit', () => {
  const m = createHotkeyMachine('ctrl+win');
  feedAll(m, [key('lctrl', true), key('lwin', true), { ev: 'other' }]);
  expect(feedAll(m, [key('lctrl', false), key('lwin', false)])).toEqual([null, null]);
  expect(feedAll(m, [key('lctrl', true), key('lwin', true)])).toEqual([null, 'down']);
});

test('Strg+C und dann Win löst nichts aus', () => {
  const m = createHotkeyMachine('ctrl+win');
  expect(feedAll(m, [key('lctrl', true), { ev: 'other' }, key('lwin', true)])).toEqual([
    null,
    null,
    null,
  ]);
});

test('rctrl: nur die rechte Strg-Taste', () => {
  const m = createHotkeyMachine('rctrl');
  expect(feedAll(m, [key('lctrl', true), key('lctrl', false)])).toEqual([null, null]);
  expect(feedAll(m, [key('rctrl', true), key('rctrl', false)])).toEqual(['down', 'up']);
});

test('ctrl+shift', () => {
  const m = createHotkeyMachine('ctrl+shift');
  expect(feedAll(m, [key('lctrl', true), key('rshift', true), key('lctrl', false)])).toEqual([
    null,
    'down',
    'up',
  ]);
});

test('einzelnes Strg löst bei ctrl+win nichts aus', () => {
  const m = createHotkeyMachine('ctrl+win');
  expect(feedAll(m, [key('lctrl', true), key('lctrl', false)])).toEqual([null, null]);
});
