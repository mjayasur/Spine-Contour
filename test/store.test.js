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
  assert.equal(state.editing, false);
  assert.equal(state.selection, null);
  assert.equal(state.running, false);
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
