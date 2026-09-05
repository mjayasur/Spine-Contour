// Which model reads which structure. Mirrors the backend's MODEL_CHOICES; the backend is
// the authority and rejects anything it does not offer, so a stale entry here fails loudly
// at /predict rather than silently measuring with the wrong thing.
//
// Only the vertebral corners have a choice. The femoral heads and the S1 endplate each have
// one model, and the Settings panel shows them as fixed so the user can see what runs.
export const VERTEBRA_MODELS = Object.freeze([
  Object.freeze({ id: 'unet', label: 'U-Net' }),
  Object.freeze({ id: 'hrnet', label: 'HRNet' }),
]);
export const FEMORAL_MODELS = Object.freeze([Object.freeze({ id: 'unet', label: 'U-Net' })]);
export const S1_MODELS = Object.freeze([Object.freeze({ id: 'keypointrcnn', label: 'Keypoint R-CNN' })]);

export const DEFAULT_MODELS = Object.freeze({ vertebrae: 'unet', femoral: 'unet', s1: 'keypointrcnn' });

const BY_STRUCTURE = { vertebrae: VERTEBRA_MODELS, femoral: FEMORAL_MODELS, s1: S1_MODELS };

export function isVertebraModel(id) {
  return VERTEBRA_MODELS.some((model) => model.id === id);
}

// The display label for a model id, or null when it is not one this build offers.
export function modelLabel(structure, id) {
  const options = BY_STRUCTURE[structure];
  if (!options) return null;
  const found = options.find((model) => model.id === id);
  return found ? found.label : null;
}

// What produced a stored result, read from the response's opaque `qc.models`. Returns the
// vertebral model's label, or null when the record predates model provenance -- an absent
// value is absent, never "U-Net" by assumption.
export function describeModels(qc) {
  const id = qc && qc.models && typeof qc.models.vertebrae === 'string' ? qc.models.vertebrae : null;
  return id === null ? null : modelLabel('vertebrae', id) ?? id;
}
