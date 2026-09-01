import { el } from '../dom.js';
import { setState } from '../store.js';

const VERSION_LABEL = 'v0.1.0';

const HERO_SVG = `<svg width="118" height="226" viewBox="0 0 100 192" fill="none">
  <g transform="translate(24,3) rotate(-10 32 24)"><path d="M16,4 C26,7 38,7 48,4 C54,2.5 58,5 57.5,10 C55.5,18 55.5,30 57.5,38 C58,43 54,45.5 48,44 C38,41 26,41 16,44 C10,45.5 6,43 6.5,38 C8.5,30 8.5,18 6.5,10 C6,5 10,2.5 16,4 Z" transform="scale(0.82)" stroke="var(--ink)" stroke-width="2.6"></path></g>
  <g transform="translate(30,44.5) rotate(-3 32 24)"><path d="M16,3.5 C27,6.5 38,6.5 48,4 C54,2.5 58,5 57.5,10 C56,18 55.5,29 57.5,38 C58,43 54,45.5 48,44 C37,41 27,41.5 16,44 C10,45.5 6,43 6.5,38 C8.5,29 9,18 6.5,10 C6,5 10,2.5 16,3.5 Z" transform="scale(0.88)" stroke="var(--ink)" stroke-width="2.4"></path></g>
  <g transform="translate(32,90) rotate(4 32 24)">
    <path d="M16,4 C26,7 39,6.5 48,4 C54,2.5 58,5 57.5,10 C55.5,19 55.5,29 57.5,38 C58,43 54,45.5 48,44 C38,41 26,41 16,44 C10,45.5 6,43 6.5,38 C8.5,29 8,19 6.5,10 C6,5 10,2.5 16,4 Z" transform="scale(0.94)" fill="var(--accent)"></path>
    <path d="M16,4 C26,7 39,6.5 48,4 C54,2.5 58,5 57.5,10 C55.5,19 55.5,29 57.5,38 C58,43 54,45.5 48,44 C38,41 26,41 16,44 C10,45.5 6,43 6.5,38 C8.5,29 8,19 6.5,10 C6,5 10,2.5 16,4 Z" transform="translate(-4.8,-4.2) scale(1.1)" stroke="var(--accent)" stroke-width="1.8" stroke-dasharray="5 4"></path>
  </g>
  <g transform="translate(25,136) rotate(10 32 24)"><path d="M16,4 C26,7 38,7 48,4 C54,2.5 58,5 57.5,11 C55.5,18 55.5,30 57.5,39 C58,43.5 54,46 48,44.5 C38,41.5 26,41.5 16,44.5 C10,46 6,43.5 6.5,39 C8.5,30 8.5,18 6.5,11 C6,5.5 10,3 16,4 Z" stroke="var(--ink)" stroke-width="2.2"></path></g>
</svg>`;

const CHECK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 L10 17.5 L19 6.5"></path></svg>';

const ARROW_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12 H18"></path><path d="M12.5 6 L18.5 12 L12.5 18"></path></svg>';

export function render(state) {
  const checkboxInput = el('input', {
    type: 'checkbox',
    checked: state.ack,
    onChange: (event) => setState({ ack: event.target.checked }),
  });

  const checkbox = el('label', { class: 'checkbox-row' },
    checkboxInput,
    el('span', { class: 'checkbox-box', innerHTML: CHECK_SVG }),
    el('span', { class: 'landing-ack-text' },
      'I understand this is a research tool and agree to cite the authors above in any resulting work.'),
  );

  const enterButton = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    disabled: !state.ack,
    onClick: () => setState({ screen: 'studies' }),
  }, 'Enter SpineContour', el('span', { class: 'btn-icon', innerHTML: ARROW_SVG }));

  const pill = el('div', { class: 'pill' },
    el('span', { class: 'dot' }),
    el('span', { class: 'label' }, 'RESEARCH USE ONLY'),
  );

  return el('div', { class: 'landing' },
    el('div', { class: 'landing-left' },
      el('div', { class: 'landing-hero', innerHTML: HERO_SVG }),
      el('div', { class: 'landing-wordmark' }, 'spine', el('span', { class: 'accent' }, 'contour')),
      el('div', { class: 'landing-tagline' }, 'VERTEBRAL SEGMENTATION & ALIGNMENT'),
      el('div', { class: 'landing-version' }, VERSION_LABEL),
    ),
    el('div', { class: 'landing-right' },
      el('div', { class: 'landing-panel' },
        pill,
        el('div', {},
          el('h1', { class: 'landing-heading' }, 'Not for diagnostic or clinical use.'),
          el('p', { class: 'landing-body' },
            'SpineContour is an investigational research tool. Its measurements, segmentations, and derived metrics have not been cleared or approved by any regulatory body. All output requires independent verification by a qualified reviewer.'),
        ),
        el('div', { class: 'citation-card card' },
          el('div', { class: 'citation-eyebrow' }, 'CITATION · REQUIRED FOR PUBLISHED USE'),
          el('div', { class: 'citation-names' },
            el('div', {}, 'Cody Woodhouse, MD'),
            el('div', {}, 'Michael Jayasuria, BS'),
          ),
          el('div', { class: 'citation-note' },
            'Any work using this software — published, presented, or internally circulated — must credit both authors.'),
        ),
        checkbox,
        el('div', { class: 'landing-actions' }, enterButton),
      ),
    ),
  );
}
