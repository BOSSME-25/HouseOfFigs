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

  window.hofRenderTestimonials = function (containerId, max) {
    var el = document.getElementById(containerId);
    if (!el) return;

    function render(list) {
      if (max) list = list.slice(0, max);
      if (!list || list.length === 0) {
        el.innerHTML = '<p class="blog-loading">Client stories are coming soon.</p>';
        return;
      }
      el.innerHTML = list.map(cardHtml).join('');
    }

    function load() {
      window.hofFirebase.getPublishedTestimonials()
        .then(render)
        .catch(function (err) {
          console.warn('Testimonials load failed:', err);
          el.innerHTML = '<p class="blog-loading">Client stories are coming soon.</p>';
        });
    }

    if (window.hofFirebase) load();
    else window.addEventListener('hofFirebaseReady', load, { once: true });
  };
})();
