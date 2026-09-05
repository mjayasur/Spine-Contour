import { el } from '../dom.js';
import { setState } from '../store.js';
import { openExternal } from '../api.js';
import { showToast } from './toast.js';
import { DEFAULT_MODELS, VERTEBRA_MODELS, modelLabel } from '../data/models.js';

const VERSION_LABEL = 'v0.1.0';
const DOCS_URL = 'https://github.com/mjayasur/Spine-Contour#readme';

const MARK_SVG = '<svg width="26" height="22" viewBox="0 0 26 22"><path d="M 8 4 H 18 C 20.5 4 22 5.5 22 8 Q 20.6 11 22 14 C 22 16.5 20.5 18 18 18 H 8 C 5.5 18 4 16.5 4 14 Q 5.4 11 4 8 C 4 5.5 5.5 4 8 4 Z" fill="var(--accent)"></path><path d="M 7 1 H 19 C 22.5 1 25 3 25 6.5 Q 23.4 11 25 15.5 C 25 19 22.5 21 19 21 H 7 C 3.5 21 1 19 1 15.5 Q 2.6 11 1 6.5 C 1 3 3.5 1 7 1 Z" fill="none" stroke="var(--accent)" stroke-width="1.4"></path></svg>';

const CHEVRON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6 L8 12 L14 18"></path></svg>';

const ICONS = {
  workspace: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7 C3.5 5.6 4.6 5 5.5 5 H9.5 L11.5 7.5 H18.5 C19.6 7.5 20.5 8.4 20.5 9.5 V17 C20.5 18.1 19.6 19 18.5 19 H5.5 C4.4 19 3.5 18.1 3.5 17 Z"></path></svg>',
  studies: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="4" width="14" height="4" rx="2"></rect><rect x="5" y="10" width="14" height="4" rx="2"></rect><rect x="5" y="16" width="14" height="4" rx="2"></rect></svg>',
  settings: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 8 H19.5"></path><circle cx="9.5" cy="8" r="2.6" fill="var(--well)"></circle><path d="M4 16 H19.5"></path><circle cx="15" cy="16" r="2.6" fill="var(--well)"></circle></svg>',
  docs: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5.5 C10 4 6.8 4 4.5 5 V18.5 C6.8 17.5 10 17.5 12 19 C14 17.5 17.2 17.5 19.5 18.5 V5 C17.2 4 14 4 12 5.5 Z"></path><path d="M12 5.5 V19"></path></svg>',
};

function modelsBlock(state) {
  const choice = state.models || DEFAULT_MODELS;
  const vertebraChoice = el('div', { class: 'model-choice', role: 'group', 'aria-label': 'L1 to L5 model' },
    ...VERTEBRA_MODELS.map((model) => el('button', {
      type: 'button',
      class: 'model-choice-btn',
      'aria-pressed': choice.vertebrae === model.id ? 'true' : 'false',
      onClick: () => setState((current) => ({ models: { ...current.models, vertebrae: model.id } })),
    }, model.label)));
  const fixed = (label) => el('span', { class: 'model-fixed' }, label);
  return el('div', { class: 'sidebar-models' },
    el('div', { class: 'eyebrow' }, 'MODELS'),
    el('div', { class: 'sidebar-models-row' }, el('div', { class: 'sidebar-models-label' }, 'L1–L5'), vertebraChoice),
    el('div', { class: 'sidebar-models-row' }, el('div', { class: 'sidebar-models-label' }, 'FEMORAL HEADS'), fixed(modelLabel('femoral', choice.femoral) ?? '—')),
    el('div', { class: 'sidebar-models-row' }, el('div', { class: 'sidebar-models-label' }, 'S1 ENDPLATE'), fixed(modelLabel('s1', choice.s1) ?? '—')),
  );
}

function navRow({ icon, label, subLabel, active, collapsed, onClick }) {
  const children = [el('span', { class: 'nav-icon', 'aria-hidden': 'true', innerHTML: icon })];
  if (!collapsed) {
    const textParts = [el('div', { class: 'nav-label' }, label)];
    if (subLabel) textParts.push(el('div', { class: 'nav-sublabel' }, subLabel));
    children.push(el('div', { class: 'nav-text' }, ...textParts));
  }
  return el('button', {
    type: 'button',
    class: `nav-row${active ? ' nav-row-active' : ''}`,
    'aria-label': label,
    onClick,
  }, ...children);
}

function workspaceStatus(state) {
  if (!state.wsFolder) return 'NOT SET';
  return `${state.wsFiles.length} FILMS · ${state.wsCsvRows.length} ROWS`;
}

function openStudyCard(state) {
  if (!state.openId) return null;
  const study = state.studies.find((item) => item.id === state.openId);
  if (!study) return null;
  return el('div', { class: 'sidebar-open-study' },
    el('div', { class: 'eyebrow' }, 'OPEN STUDY'),
    el('div', { class: 'open-study-id' }, study.id),
    el('div', { class: 'open-study-meta' }, `${study.view} · ${study.pt || '—'}`),
  );
}

export function render(state) {
  const collapsed = state.navCollapsed;

  const logoRow = el('div', { class: 'sidebar-logo-row' },
    el('span', { class: 'sidebar-mark', innerHTML: MARK_SVG }),
    collapsed ? null : el('div', { class: 'sidebar-wordmark' }, 'spine', el('span', { class: 'accent' }, 'contour')),
    el('button', {
      type: 'button',
      class: 'icon-btn sidebar-collapse',
      title: 'Collapse sidebar',
      'aria-label': collapsed ? 'Expand sidebar' : 'Collapse sidebar',
      onClick: () => setState((current) => ({ navCollapsed: !current.navCollapsed })),
    }, el('span', {
      class: `sidebar-chevron${collapsed ? ' sidebar-chevron-collapsed' : ''}`,
      'aria-hidden': 'true',
      innerHTML: CHEVRON_SVG,
    })),
  );

  const themeRow = state.settingsOpen && !collapsed
    ? el('div', { class: 'sidebar-theme-row' },
      el('div', { class: 'eyebrow' }, 'THEME'),
      el('div', { class: 'sidebar-spacer' }),
      el('button', {
        type: 'button',
        class: `theme-toggle${state.theme === 'dark' ? ' theme-toggle-dark' : ''}`,
        'aria-label': 'Toggle theme',
        'aria-pressed': state.theme === 'dark' ? 'true' : 'false',
        onClick: () => setState((current) => ({ theme: current.theme === 'light' ? 'dark' : 'light' })),
      }, el('div', { class: 'theme-toggle-knob' })),
    )
    : null;

  const nav = el('nav', { class: 'sidebar-nav' },
    navRow({
      icon: ICONS.workspace,
      label: 'Workspace',
      subLabel: workspaceStatus(state),
      active: state.screen === 'workspace',
      collapsed,
      onClick: () => setState({ screen: 'workspace' }),
    }),
    navRow({
      icon: ICONS.studies,
      label: 'Studies',
      active: state.screen === 'studies',
      collapsed,
      onClick: () => setState({ screen: 'studies' }),
    }),
    navRow({
      icon: ICONS.settings,
      label: 'Settings',
      active: state.settingsOpen,
      collapsed,
      onClick: () => setState((current) => ({ settingsOpen: !current.settingsOpen })),
    }),
    themeRow,
    state.settingsOpen && !collapsed ? modelsBlock(state) : null,
    navRow({
      icon: ICONS.docs,
      label: 'Documentation',
      collapsed,
      onClick: async () => {
        try {
          await openExternal(DOCS_URL);
        } catch (error) {
          showToast(`Could not open documentation: ${error.message}`);
        }
      },
    }),
    openStudyCard(state),
  );

  const footer = collapsed
    ? null
    : el('div', { class: 'sidebar-footer' },
      el('div', { class: 'eyebrow' }, 'RESEARCH USE ONLY'),
      el('div', { class: 'eyebrow' }, VERSION_LABEL),
    );

  return el('aside', { class: `sidebar${collapsed ? ' sidebar-collapsed' : ''}` }, logoRow, nav, footer);
}
