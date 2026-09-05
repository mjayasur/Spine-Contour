import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODELS, FEMORAL_MODELS, S1_MODELS, VERTEBRA_MODELS,
  describeModels, isVertebraModel, modelLabel,
} from '../renderer/data/models.js';
import { getState } from '../renderer/store.js';

test('only the vertebrae offer a choice; the other structures have one model each', () => {
  assert.equal(VERTEBRA_MODELS.length, 2);
  assert.equal(FEMORAL_MODELS.length, 1);
  assert.equal(S1_MODELS.length, 1);
  assert.deepEqual(VERTEBRA_MODELS.map((m) => m.id), ['unet', 'hrnet']);
});

test('the default choice is offered for every structure and matches the store', () => {
  assert.ok(isVertebraModel(DEFAULT_MODELS.vertebrae));
  assert.equal(modelLabel('femoral', DEFAULT_MODELS.femoral), 'U-Net');
  assert.equal(modelLabel('s1', DEFAULT_MODELS.s1), 'Keypoint R-CNN');
  assert.deepEqual(getState().models, DEFAULT_MODELS);
});

test('modelLabel is null for anything this build does not offer', () => {
  assert.equal(modelLabel('vertebrae', 'resnet'), null);
  assert.equal(modelLabel('disc', 'unet'), null);
  assert.equal(isVertebraModel('resnet'), false);
});

test('describeModels reads provenance and is null when a record has none', () => {
  assert.equal(describeModels({ models: { vertebrae: 'hrnet' } }), 'HRNet');
  assert.equal(describeModels({ models: { vertebrae: 'unet' } }), 'U-Net');
  assert.equal(describeModels({ femoral: { confidence: 0.9 } }), null);
  assert.equal(describeModels(null), null);
  assert.equal(describeModels(undefined), null);
  // An id the build does not know is shown as itself, never relabelled as something it isn't.
  assert.equal(describeModels({ models: { vertebrae: 'future' } }), 'future');
});
