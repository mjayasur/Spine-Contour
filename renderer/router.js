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

// ---------------------------------------------------------------------------
// Host key sets
//
// renderRoute() builds the persistent page shell once (see the module-scope
// node references below) and, on every store update, remounts only the
// "host" whose own declared state slice actually changed. Everything else is
// left alone in the DOM, so CSS transitions on persistent nodes (.sidebar's
// width, .toast's opacity) can actually animate instead of restarting from a
// freshly created node every render, and a future 60fps zoom/pan viewer can
// update its own <canvas> without a screen-host remount tearing the 2D
// context out from under it.
//
// *** These sets are the ONLY thing that tells a host to update. A plan that
// *** adds a new state key a host's markup depends on MUST add that key to
// *** the matching set below, or the host will silently stop updating for
// *** that key -- no error, no warning, just a UI that stops responding. ***

// Sidebar re-renders for: its own collapse/theme/settings toggles, the
// active-nav highlight (`screen`), the "open study" card (`openId`,
// `studies`), and the workspace status line (`wsFolder`, `wsFiles`,
// `wsCsvRows`). See components/sidebar.js.
export const SIDEBAR_KEYS = [
  'navCollapsed',
  'settingsOpen',
  'theme',
  'screen',
  'openId',
  'studies',
  'wsFolder',
  'wsFiles',
  'wsCsvRows',
];

// `screen` selects which screen module is mounted. `ack` is here only
// because landing.js's render() reads it (checkbox `checked`, "Enter
// SpineContour" `disabled`) and landing.js is one of the modules this host
// mounts. studies.js, workspace.js and analysis.js read nothing from state
// today -- if any of them starts reading a state key, add it here too.
export const SCREEN_KEYS = ['screen', 'ack'];

export const TOAST_KEYS = ['toast'];

// zoom, panX, panY and panMode are deliberately absent from every set above:
// nothing mounted by renderRoute reads them yet. The zoom/pan viewer planned
// next must subscribe to the store itself (see the future
// viewer/interactions.js) rather than being wired into SCREEN_KEYS -- adding
// them here would make every pointermove-driven pan frame remount the screen
// host and destroy the canvas mid-gesture, which is the exact failure mode
// this file exists to prevent.

function keysChanged(prevState, nextState, keys) {
  if (!prevState) return true;
  return keys.some((key) => prevState[key] !== nextState[key]);
}

// Swaps a container's content, preserving keyboard focus across the swap
// when possible.
//
// router.js has no virtual DOM and does not diff old vs. new trees -- per
// the architecture contract, a host whose keys changed is rebuilt from
// scratch -- so the previously-focused element is genuinely a different
// object afterward. Left alone, that would mean remounting the Landing
// screen host in response to the acknowledgement checkbox's own onChange
// drops focus to <body> (the bug this file exists to fix), and the same
// would happen to the sidebar's collapse button when it toggles
// `navCollapsed`. We snapshot which descendant of `oldNode` had focus (by
// tag name and its ordinal position among same-tag descendants) before the
// swap, then refocus the equivalent element in `freshNode` synchronously
// afterward, so there is no rendered frame in which focus visibly rests on
// <body>.
function swap(parent, oldNode, freshNode, beforeNode) {
  const active = document.activeElement;
  let restoreSelf = false;
  let restoreTag = null;
  let restoreIndex = -1;
  if (oldNode && active) {
    if (active === oldNode) {
      restoreSelf = true;
    } else if (oldNode.contains(active)) {
      restoreTag = active.tagName;
      restoreIndex = Array.from(oldNode.getElementsByTagName(restoreTag)).indexOf(active);
    }
  }

  if (oldNode) {
    parent.replaceChild(freshNode, oldNode);
  } else if (beforeNode) {
    parent.insertBefore(freshNode, beforeNode);
  } else {
    parent.appendChild(freshNode);
  }

  if (restoreSelf) {
    if (typeof freshNode.focus === 'function') freshNode.focus();
  } else if (restoreTag && restoreIndex >= 0) {
    const candidate = freshNode.getElementsByTagName(restoreTag)[restoreIndex];
    if (candidate && typeof candidate.focus === 'function') candidate.focus();
  }

  return freshNode;
}

// ---------------------------------------------------------------------------
// Persistent shell, built once and reused across renders.
//
// There are two top-level modes. Landing mode (`!state.ack ||
// state.screen === 'landing'`) is a full-page gate with no sidebar; Shell
// mode is `.app-page` > `.app-shell` > [sidebar, screen]. Switching between
// the two modes rebuilds the top level -- a rare, deliberate transition --
// but within a mode the sidebar/screen/toast hosts persist and are only
// remounted individually per the key sets above.

let mode = null; // 'landing' | 'shell' | null (nothing built yet)
let prevState = null;

// Toast host: created once, persists across BOTH modes and every remount.
// role="status"/aria-live="polite" are set once, here, on the host itself --
// never on the node toast.js returns, which is swapped out under this host
// on every toast change. That is what makes it a valid live region: a live
// region must be a persistent node that is present before its text changes.
let toastHostNode = null;

// Landing mode's single host (no sidebar to separate it from).
let landingNode = null;

// Shell mode's hosts.
let appPageNode = null;
let appShellNode = null;
let sidebarNode = null;
let screenNode = null;

export function renderRoute(root, state) {
  const nextMode = !state.ack || state.screen === 'landing' ? 'landing' : 'shell';

  if (nextMode !== mode) {
    if (landingNode) {
      root.removeChild(landingNode);
      landingNode = null;
    }
    if (appPageNode) {
      root.removeChild(appPageNode);
      appPageNode = null;
      appShellNode = null;
      sidebarNode = null;
      screenNode = null;
    }
    mode = nextMode;
  }

  if (!toastHostNode) {
    toastHostNode = el('div', { role: 'status', 'aria-live': 'polite' });
    root.append(toastHostNode);
  }

  if (mode === 'landing') {
    if (!landingNode || keysChanged(prevState, state, SCREEN_KEYS)) {
      landingNode = swap(root, landingNode, renderLanding(state), toastHostNode);
    }
  } else {
    if (!appPageNode) {
      sidebarNode = renderSidebar(state);
      const renderScreen = SCREENS[state.screen] || renderStudies;
      screenNode = renderScreen(state);
      appShellNode = el('div', { class: 'app-shell' }, sidebarNode, screenNode);
      appPageNode = el('div', { class: 'app-page' }, appShellNode);
      root.insertBefore(appPageNode, toastHostNode);
    } else {
      if (keysChanged(prevState, state, SIDEBAR_KEYS)) {
        sidebarNode = swap(appShellNode, sidebarNode, renderSidebar(state));
      }
      if (keysChanged(prevState, state, SCREEN_KEYS)) {
        const renderScreen = SCREENS[state.screen] || renderStudies;
        screenNode = swap(appShellNode, screenNode, renderScreen(state));
      }
    }
  }

  if (!toastHostNode.firstChild || keysChanged(prevState, state, TOAST_KEYS)) {
    mount(toastHostNode, renderToast(state));
  }

  prevState = state;
}
