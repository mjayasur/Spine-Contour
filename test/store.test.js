import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getState, setState, subscribe } from '../renderer/store.js';

test('getState returns the documented initial shape', () => {
  const state = getState();
  assert.equal(state.screen, 'landing');
  assert.equal(state.ack, false);
  assert.equal(state.theme, 'light');
  assert.equal(state.navCollapsed, false);
  assert.equal(state.settingsOpen, false);
  assert.deepEqual(state.studies, []);
  assert.equal(state.query, '');
  assert.equal(state.openId, null);
  assert.equal(state.compareId, null);
  assert.equal(state.tab, 'meas');
  assert.equal(state.selectedLevel, null);
  assert.equal(state.overlays, true);
  assert.equal(state.overlayOpacity, 50);
  assert.equal(state.zoom, 1);
  assert.equal(state.panX, 0);
  assert.equal(state.panY, 0);
  assert.equal(state.panMode, false);
  assert.equal(state.showAllLordosis, false);
  assert.deepEqual(state.models, { vertebrae: 'unet', femoral: 'unet', s1: 'keypointrcnn' });
  assert.equal(state.editing, false);
  assert.equal(state.selection, null);
  assert.equal(state.running, null);
  assert.equal(state.runStage, null);
  assert.equal(state.wsFolder, null);
  assert.deepEqual(state.wsFiles, []);
  assert.equal(state.wsCsv, null);
  assert.deepEqual(state.wsCsvHeaders, []);
  assert.deepEqual(state.wsCsvRows, []);
  assert.deepEqual(state.wsMapping, []);
  assert.deepEqual(state.fields, []);
  assert.equal(state.dataOpen, true);
  assert.equal(state.toast, '');
});

test('getState returns a frozen copy that cannot be mutated', () => {
  const state = getState();
  assert.throws(() => { state.ack = true; });
});

test('setState shallow-merges a plain object patch', () => {
  setState({ ack: true });
  assert.equal(getState().ack, true);
  assert.equal(getState().theme, 'light');
});

test('setState accepts an updater function receiving current state', () => {
  setState({ zoom: 2 });
  setState((current) => ({ zoom: current.zoom + 1 }));
  assert.equal(getState().zoom, 3);
});

test('subscribe notifies listeners synchronously with the new state and returns an unsubscribe function', () => {
  const seen = [];
  const unsubscribe = subscribe((state) => seen.push(state.toast));
  setState({ toast: 'hello' });
  assert.deepEqual(seen, ['hello']);
  unsubscribe();
  setState({ toast: 'world' });
  assert.deepEqual(seen, ['hello']);
});

test('getState returns a fresh object reference on each call', () => {
  assert.notEqual(getState(), getState());
});

test('setState replaces a nested object value wholesale (shallow merge)', () => {
  setState({ selection: { a: 1, b: 2 } });
  setState({ selection: { c: 3 } });
  assert.deepEqual(getState().selection, { c: 3 });
});

test('setState throws when called re-entrantly from a subscriber, and the store keeps working afterward', () => {
  let caught = null;
  const unsubscribe = subscribe(() => {
    try {
      setState({ query: 'nested' });
    } catch (err) {
      caught = err;
    }
  });
  setState({ query: 'outer' });
  unsubscribe();

  assert.ok(caught instanceof Error);
  assert.match(caught.message, /setState/);
  assert.equal(getState().query, 'outer', 'the re-entrant patch must not have applied');

  // Proves the finally block cleared the notifying flag: a normal setState
  // right after a re-entrant throw must still work.
  setState({ query: 'after' });
  assert.equal(getState().query, 'after');
});

test('a subscriber that throws is reported and does not stop the subscribers after it', () => {
  const reported = [];
  const originalError = console.error;
  console.error = (...args) => reported.push(args);
  const seen = [];
  const unsubscribeThrower = subscribe(() => { throw new Error('draw failed'); });
  const unsubscribeLater = subscribe((state) => seen.push(state.toast));
  try {
    setState({ toast: 'still delivered' });
  } finally {
    console.error = originalError;
    unsubscribeThrower();
    unsubscribeLater();
  }
  assert.deepEqual(seen, ['still delivered'], 'the later subscriber must still be notified');
  assert.equal(reported.length, 1, 'the throw is reported exactly once');
  assert.ok(reported[0].some((arg) => arg instanceof Error && arg.message === 'draw failed'));
  // The notifying flag was cleared: the store keeps working afterwards.
  setState({ toast: '' });
  assert.equal(getState().toast, '');
});
