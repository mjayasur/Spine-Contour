import { getState, setState, subscribe } from './store.js';
import { renderRoute } from './router.js';
import { loadStudies, saveStudies, disablePersistence } from './api.js';
import { merge, createStudySaver } from './data/persistence.js';
import { showToast } from './components/toast.js';

const root = document.querySelector('#app');

function applyTheme(state) {
  document.body.toggleAttribute('data-dark', state.theme === 'dark');
}

function render(state) {
  applyTheme(state);
  renderRoute(root, state);
}

// Load before the first paint. A store that cannot be read (a newer version, a record with a
// broken identity) is left exactly as it is on disk: the app runs on the demo studies and
// persistence is disabled for the session -- the saver reports once, and every later
// saveStudies/savePrediction rejects -- so nothing on disk is overwritten with less than it held.
let loadError = null;
let real = [];
try {
  real = await loadStudies();
} catch (error) {
  loadError = error;
  disablePersistence(error.message);
}
const studies = merge(real);
setState({ studies });

const saver = createStudySaver({
  save: saveStudies,
  initial: studies,
  disabledReason: loadError ? loadError.message : null,
  // notify() runs inside a store notification, where setState is forbidden; the toast is
  // deferred one microtask so it never re-enters the store.
  onError: (error) => queueMicrotask(() => showToast(error.message)),
});
subscribe(saver.notify);
subscribe(render);
render(getState());
if (loadError) showToast(`Saved studies could not be loaded: ${loadError.message}`);

// A film dropped anywhere but the Studies dropzone would navigate the window to that file.
// The dropzone handles its own drop first (target phase); these catch everything else.
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => event.preventDefault());
