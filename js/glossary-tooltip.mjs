/**
 * Glossary tooltip system.
 *
 * Loaded on pages that want to show definitions for special terms.
 *
 * Usage in HTML:
 *   <button type="button" class="define-term" data-term="inflammation">inflammation</button>
 *
 * Behavior:
 *   - Desktop: hover shows the definition popover; click/tap also works.
 *   - Mobile / touch: tap the term to open a centered modal-style popover,
 *     tap outside (or the close button) to dismiss.
 *   - The popover positions itself near the term on desktop, and as a
 *     centered card on small screens.
 *
 * Keyboard: terms are <button>s, so they're focusable and Enter/Space
 * open the popover. Escape closes.
 */

import { GLOSSARY } from './glossary.mjs';

const SUPPORTS_HOVER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const TOUCH = window.matchMedia('(pointer: coarse)').matches;

let popover = null;
let hoverTimer = null;
let activeTerm = null;

function injectStyles() {
  if (document.getElementById('glossary-styles')) return;
  const style = document.createElement('style');
  style.id = 'glossary-styles';
  style.textContent = `
    .define-term {
      background: none;
      border: none;
      padding: 0 0 1px;
      font: inherit;
      color: inherit;
      cursor: help;
      border-bottom: 1px dotted rgba(139, 94, 90, 0.55);
      display: inline;
      text-align: inherit;
      line-height: inherit;
    }
    .define-term:hover,
    .define-term:focus-visible {
      color: #8B5E5A;
      border-bottom-color: #8B5E5A;
      outline: none;
    }
    /* Backdrop (mobile only — taps elsewhere to close) */
    .gloss-backdrop {
      position: fixed;
      inset: 0;
      background-color: rgba(74, 55, 40, 0.35);
      backdrop-filter: blur(2px);
      z-index: 9998;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .gloss-backdrop.visible { opacity: 1; }

    /* Popover */
    .gloss-popover {
      position: absolute;
      z-index: 9999;
      max-width: 320px;
      background-color: #fff;
      color: #2C2C2C;
      border-radius: 10px;
      box-shadow: 0 12px 40px rgba(74, 55, 40, 0.2), 0 4px 12px rgba(74, 55, 40, 0.08);
      padding: 1.1rem 1.25rem 1.15rem;
      font-family: 'Inter', -apple-system, sans-serif;
      font-size: 0.875rem;
      line-height: 1.55;
      opacity: 0;
      transform: scale(0.96) translateY(-4px);
      transition: opacity 0.18s ease, transform 0.18s ease;
      pointer-events: none;
      border: 1px solid rgba(212, 197, 178, 0.5);
    }
    .gloss-popover.visible {
      opacity: 1;
      transform: scale(1) translateY(0);
      pointer-events: auto;
    }
    .gloss-popover::before {
      content: '';
      position: absolute;
      width: 10px;
      height: 10px;
      background-color: #fff;
      border-left: 1px solid rgba(212, 197, 178, 0.5);
      border-top: 1px solid rgba(212, 197, 178, 0.5);
      transform: rotate(45deg);
      top: -6px;
      left: 24px;
    }
    .gloss-popover.below-flip::before {
      top: auto;
      bottom: -6px;
      transform: rotate(225deg);
    }
    .gloss-popover .gloss-term {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.125rem;
      color: #4A3728;
      font-weight: 500;
      margin: 0 0 0.4rem;
      padding-right: 1.5rem;
    }
    .gloss-popover .gloss-def {
      margin: 0;
      color: #2C2C2C;
    }
    .gloss-popover .gloss-illust {
      margin: 0.85rem 0 0;
      width: 100%;
      max-height: 200px;
      object-fit: cover;
      border-radius: 6px;
      display: block;
      background-color: #faf6ef;
    }
    .gloss-popover .gloss-close {
      position: absolute;
      top: 0.4rem;
      right: 0.5rem;
      background: none;
      border: none;
      font-size: 1.25rem;
      color: #897866;
      cursor: pointer;
      line-height: 1;
      padding: 0.25rem 0.5rem;
      display: none;
    }
    .gloss-popover .gloss-close:hover { color: #4A3728; }

    /* Mobile / touch: full-width centered modal */
    @media (max-width: 600px), (pointer: coarse) {
      .gloss-popover {
        position: fixed;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) scale(0.96);
        max-width: calc(100vw - 2.5rem);
        width: 360px;
      }
      .gloss-popover.visible {
        transform: translate(-50%, -50%) scale(1);
      }
      .gloss-popover::before { display: none; }
      .gloss-popover .gloss-close { display: block; }
    }

    @media print {
      .define-term {
        border-bottom: none;
      }
      .define-term::after { display: none; }
      .gloss-popover, .gloss-backdrop { display: none !important; }
    }
  `;
  document.head.appendChild(style);
}

function buildPopover() {
  injectStyles();
  if (popover) return popover;
  popover = document.createElement('div');
  popover.className = 'gloss-popover';
  popover.setAttribute('role', 'tooltip');
  document.body.appendChild(popover);
  return popover;
}

let backdrop = null;
function showBackdrop() {
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.className = 'gloss-backdrop';
    backdrop.addEventListener('click', hidePopover);
    document.body.appendChild(backdrop);
  }
  requestAnimationFrame(() => backdrop.classList.add('visible'));
}
function hideBackdrop() {
  if (backdrop) backdrop.classList.remove('visible');
}

function getEntry(key) {
  // Allow exact match or normalized key
  if (GLOSSARY[key]) return GLOSSARY[key];
  const norm = key.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return GLOSSARY[norm] || null;
}

function renderPopoverContent(entry) {
  const pop = buildPopover();
  let html = '';
  html += '<button type="button" class="gloss-close" aria-label="Close">&times;</button>';
  html += '<p class="gloss-term">' + escapeHtml(entry.term) + '</p>';
  html += '<p class="gloss-def">' + escapeHtml(entry.definition) + '</p>';
  if (entry.illustration) {
    html += '<img class="gloss-illust" src="' + escapeHtml(entry.illustration) + '" alt="">';
  }
  pop.innerHTML = html;
  const closeBtn = pop.querySelector('.gloss-close');
  if (closeBtn) closeBtn.addEventListener('click', hidePopover);
  return pop;
}

function positionPopover(pop, trigger) {
  // On mobile / coarse pointer, CSS pins it to the center — skip JS positioning.
  if (TOUCH || window.matchMedia('(max-width: 600px)').matches) {
    pop.style.top = '';
    pop.style.left = '';
    pop.classList.remove('below-flip');
    return;
  }

  const rect = trigger.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  const scrollY = window.scrollY;
  const scrollX = window.scrollX;
  const margin = 12;

  // Default: below the term
  let top = scrollY + rect.bottom + 10;
  let left = scrollX + rect.left;

  // If it would overflow the right edge, shift left
  const rightEdge = scrollX + window.innerWidth - margin;
  if (left + popRect.width > rightEdge) {
    left = rightEdge - popRect.width;
  }
  if (left < scrollX + margin) left = scrollX + margin;

  // If it would overflow bottom of viewport, position above instead
  const viewportBottom = scrollY + window.innerHeight - margin;
  if (top + popRect.height > viewportBottom) {
    top = scrollY + rect.top - popRect.height - 10;
    pop.classList.add('below-flip');
  } else {
    pop.classList.remove('below-flip');
  }

  pop.style.top = top + 'px';
  pop.style.left = left + 'px';
}

function showPopover(trigger) {
  const key = trigger.dataset.term;
  const entry = getEntry(key);
  if (!entry) {
    console.warn('No glossary entry for:', key);
    return;
  }
  activeTerm = trigger;
  const pop = renderPopoverContent(entry);
  // First make it visible-but-hidden to measure, then position
  pop.classList.add('visible');
  positionPopover(pop, trigger);
  if (TOUCH || window.matchMedia('(max-width: 600px)').matches) {
    showBackdrop();
  }
}

function hidePopover() {
  if (popover) popover.classList.remove('visible');
  hideBackdrop();
  activeTerm = null;
}

function init() {
  injectStyles();

  // Click / tap — works on both touch and desktop
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.define-term');
    if (trigger) {
      e.preventDefault();
      if (activeTerm === trigger) {
        hidePopover();
      } else {
        showPopover(trigger);
      }
      return;
    }
    // Click outside the popover — close it
    if (popover && !e.target.closest('.gloss-popover')) {
      hidePopover();
    }
  });

  // Hover for desktop (with delay so it's not aggressive)
  if (SUPPORTS_HOVER && !TOUCH) {
    document.addEventListener('mouseover', (e) => {
      const trigger = e.target.closest('.define-term');
      if (!trigger) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => showPopover(trigger), 280);
    });
    document.addEventListener('mouseout', (e) => {
      const trigger = e.target.closest('.define-term');
      if (!trigger) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        if (popover && !popover.matches(':hover')) hidePopover();
      }, 250);
    });
  }

  // Keyboard support
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popover) hidePopover();
  });

  // Reposition popover on scroll/resize while open
  window.addEventListener('scroll', () => {
    if (activeTerm && popover) positionPopover(popover, activeTerm);
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (activeTerm && popover) positionPopover(popover, activeTerm);
  });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
