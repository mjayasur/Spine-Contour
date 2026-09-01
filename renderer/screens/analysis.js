import { el } from '../dom.js';

export function render() {
  return el('main', { class: 'placeholder-screen' }, el('p', {}, 'Coming soon'));
}
