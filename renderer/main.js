import { getState, subscribe } from './store.js';
import { renderRoute } from './router.js';

const root = document.querySelector('#app');

function applyTheme(state) {
  document.body.toggleAttribute('data-dark', state.theme === 'dark');
}

function render(state) {
  applyTheme(state);
  renderRoute(root, state);
}

subscribe(render);
render(getState());
