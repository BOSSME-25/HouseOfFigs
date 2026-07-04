/**
 * Renders published testimonials from Firestore into a grid container.
 * Shared by index.html (homepage, capped) and testimonials.html (full page).
 *
 * Usage (after firebase-public.mjs is on the page):
 *   hofRenderTestimonials('testimonials-grid');      // all
 *   hofRenderTestimonials('testimonials-grid', 3);   // homepage: first 3
 */
(function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function cardHtml(t) {
    var initial = (String(t.name || '?').trim().charAt(0) || '?').toUpperCase();
    var ctx = t.context ? '<span>' + esc(t.context) + '</span>' : '';
    return '<div class="testimonial-card fade-in">' +
      '<div class="testimonial-quote" aria-hidden="true">“</div>' +
      '<p class="testimonial-text">' + esc(t.quote) + '</p>' +
      '<div class="testimonial-author">' +
        '<div class="testimonial-avatar">' + esc(initial) + '</div>' +
        '<div class="testimonial-info"><strong>' + esc(t.name) + '</strong>' + ctx + '</div>' +
      '</div></div>';
  }

  // Admin preview: an unsaved draft handed over via localStorage (see
  // openSitePreview in admin.js). Only honored with ?preview=1 in the URL,
  // so the homepage strip and normal visits are untouched.
  function previewDraft() {
    if (new URLSearchParams(window.location.search).get('preview') !== '1') return null;
    try {
      var draft = JSON.parse(localStorage.getItem('hof_preview') || 'null');
      return draft && draft.kind === 'testimonial' ? draft.data : null;
    } catch (e) { return null; }
  }

  window.hofRenderTestimonials = function (containerId, max) {
    var el = document.getElementById(containerId);
    if (!el) return;

    var draft = previewDraft();
    if (draft) {
      var banner = document.createElement('div');
      banner.className = 'preview-banner';
      banner.textContent = 'Preview — the outlined card is how the testimonial will look. It is NOT published yet; close this tab and Save in the dashboard.';
      document.body.prepend(banner);
    }

    function render(list) {
      if (max) list = list.slice(0, max);
      var cards = (list || []).map(cardHtml);
      if (draft) {
        cards.unshift('<div class="preview-card-wrap">' + cardHtml(draft) + '</div>');
      }
      if (cards.length === 0) {
        el.innerHTML = '<p class="blog-loading">Client stories are coming soon.</p>';
        return;
      }
      el.innerHTML = cards.join('');
      if (window.hofObserveFadeIns) window.hofObserveFadeIns(el);
    }

    function load() {
      window.hofFirebase.getPublishedTestimonials()
        .then(render)
        .catch(function (err) {
          console.warn('Testimonials load failed:', err);
          render([]);
        });
    }

    if (window.hofFirebase) load();
    else window.addEventListener('hofFirebaseReady', load, { once: true });
  };
})();
