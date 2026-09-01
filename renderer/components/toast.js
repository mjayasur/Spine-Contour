import { el } from '../dom.js';
import { setState } from '../store.js';

let dismissTimer = null;

export function showToast(message) {
  if (dismissTimer) clearTimeout(dismissTimer);
  setState({ toast: message });
  dismissTimer = setTimeout(() => {
    setState({ toast: '' });
    dismissTimer = null;
  }, 2200);
}

export function render(state) {
  const visible = Boolean(state.toast);
  return el('div', { class: `toast${visible ? ' toast-visible' : ''}` }, state.toast || '');
}
