/**
 * Status derivation (spec 13.1, architecture contract "renderer/data/status.js").
 * Status is never stored on a Study — it is computed from measurements and qc
 * every time it is needed. Pure. The residual threshold is measurements.js's,
 * re-exported, so the panel's consistency warning and the list's status can never
 * disagree.
 */

import { piResidual, RESIDUAL_LIMIT } from './measurements.js';

export { RESIDUAL_LIMIT };
export const CONFIDENCE_LIMIT = 0.6;

/** @returns {'seg'|'rev'|'proc'} */
export function deriveStatus(study) {
  if (!study || study.measurements == null) return 'proc';
  const residual = piResidual(study.measurements);
  const confidence = study.qc && study.qc.femoral ? study.qc.femoral.confidence : null;
  if (residual > RESIDUAL_LIMIT) return 'rev';
  if (typeof confidence === 'number' && confidence < CONFIDENCE_LIMIT) return 'rev';
  return 'seg';
}

export function statusLabel(status) {
  if (status === 'seg') return 'Segmented';
  if (status === 'rev') return 'Needs review';
  return 'Processing';
}
