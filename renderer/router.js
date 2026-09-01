import { el, mount } from './dom.js';
import { render as renderLanding } from './screens/landing.js';
import { render as renderWorkspace } from './screens/workspace.js';
import { render as renderStudies } from './screens/studies.js';
import { render as renderAnalysis } from './screens/analysis.js';
import { render as renderSidebar } from './components/sidebar.js';
import { render as renderToast } from './components/toast.js';

const SCREENS = {
  workspace: renderWorkspace,
  studies: renderStudies,
  analysis: renderAnalysis,
};

export function renderRoute(root, state) {
  if (!state.ack || state.screen === 'landing') {
    mount(root, renderLanding(state));
    return;
  }
  const renderScreen = SCREENS[state.screen] || renderStudies;
  const shell = el('div', { class: 'app-shell' }, renderSidebar(state), renderScreen(state));
  const page = el('div', { class: 'app-page' }, shell, renderToast(state));
  mount(root, page);
}
