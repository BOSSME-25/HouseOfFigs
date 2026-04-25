/* ============================================
   House of Figs — Main JavaScript
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

  // --- Mobile Menu Toggle ---
  const menuToggle = document.querySelector('.menu-toggle');
  const mainNav = document.querySelector('.main-nav');

  if (menuToggle && mainNav) {
    menuToggle.addEventListener('click', () => {
      menuToggle.classList.toggle('active');
      mainNav.classList.toggle('open');
      document.body.style.overflow = mainNav.classList.contains('open') ? 'hidden' : '';
    });

    // Close menu when a nav link is clicked
    mainNav.querySelectorAll('.nav-links a').forEach(link => {
      link.addEventListener('click', () => {
        menuToggle.classList.remove('active');
        mainNav.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  // --- Header scroll effect ---
  const header = document.querySelector('.site-header');

  if (header) {
    const onScroll = () => {
      header.classList.toggle('scrolled', window.scrollY > 20);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // --- Scroll fade-in animations ---
  const fadeElements = document.querySelectorAll('.fade-in');

  if (fadeElements.length > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );

    fadeElements.forEach(el => observer.observe(el));
  }

  // --- Service detail scroll animations ---
  const serviceImages = document.querySelectorAll('.service-detail-image');
  const serviceContents = document.querySelectorAll('.service-detail-content');
  const inViewElements = [...serviceImages, ...serviceContents];

  if (inViewElements.length > 0) {
    const serviceObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            serviceObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' }
    );

    inViewElements.forEach(el => serviceObserver.observe(el));
  }

  // --- Active nav link highlighting ---
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks = document.querySelectorAll('.nav-links a');

  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });

  // --- Newsletter form (placeholder behavior) ---
  const newsletterForms = document.querySelectorAll('.newsletter-form');

  newsletterForms.forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      if (input && input.value) {
        const btn = form.querySelector('.btn');
        const originalText = btn.textContent;
        btn.textContent = 'Thank you!';
        btn.style.pointerEvents = 'none';
        input.value = '';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.pointerEvents = '';
        }, 3000);
      }
    });
  });

  // --- Contact form (placeholder behavior) ---
  const contactForm = document.querySelector('.contact-form');

  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = contactForm.querySelector('.btn');
      const originalText = btn.textContent;
      btn.textContent = 'Message Sent!';
      btn.style.pointerEvents = 'none';
      contactForm.reset();
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.pointerEvents = '';
      }, 3000);
    });
  }

  // --- First-visit Welcome Modal ("Hi, I'm Bethany") ---
  // Shows once per browser/device. Dismissal is sticky via localStorage.
  // Bypass with ?welcome=1 in the URL for easy testing.
  (function welcomeModal() {
    var STORAGE_KEY = 'hof-welcome-seen-v1';
    var force = false;
    try {
      var qs = new URLSearchParams(window.location.search);
      force = qs.get('welcome') === '1';
    } catch (e) { /* ignore */ }

    try {
      if (!force && window.localStorage.getItem(STORAGE_KEY)) return;
    } catch (e) {
      // If localStorage is unavailable (private mode w/ strict settings),
      // skip the modal rather than annoying the visitor on every page.
      return;
    }

    var overlay = document.createElement('div');
    overlay.className = 'hof-welcome-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'hof-welcome-title');
    overlay.innerHTML =
      '<div class="hof-welcome-modal">' +
        '<button type="button" class="hof-welcome-close" aria-label="Close welcome">&times;</button>' +
        '<div class="hof-welcome-image">' +
          '<img src="images/bethany.jpg" alt="Bethany Grissum, founder of House of Figs Functional Nutrition">' +
        '</div>' +
        '<div class="hof-welcome-body">' +
          '<p class="hof-welcome-eyebrow">A note from your guide</p>' +
          '<h2 id="hof-welcome-title" class="hof-welcome-title">Hi, I&rsquo;m Bethany.</h2>' +
          '<div class="hof-welcome-text">' +
            '<p>Welcome to House of Figs &mdash; a place of nourishment, fruitfulness, and healing, named for the meaning of my own name, Bethany.</p>' +
            '<p>However you found us, I&rsquo;m glad you&rsquo;re here. Take your time, look around, and reach out whenever you&rsquo;re ready.</p>' +
            '<p class="hof-welcome-tagline">Rooted wellness. Sustainable transformation.</p>' +
          '</div>' +
          '<div class="hof-welcome-actions">' +
            '<a href="about.html" class="btn btn--secondary">Read my full story &rarr;</a>' +
            '<button type="button" class="btn btn--primary" data-hof-welcome-begin>Explore the site</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    function dismiss() {
      try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch (e) { /* ignore */ }
      document.body.classList.remove('hof-welcome-open');
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
    }

    function onEsc(e) {
      if (e.key === 'Escape') dismiss();
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) dismiss();
    });
    overlay.querySelector('.hof-welcome-close').addEventListener('click', dismiss);
    overlay.querySelector('[data-hof-welcome-begin]').addEventListener('click', dismiss);
    // Also dismiss when the user clicks "Read my full story" so they don't
    // come back from /about and see the modal again.
    var aboutLink = overlay.querySelector('a[href="about.html"]');
    if (aboutLink) aboutLink.addEventListener('click', function () {
      try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch (e) { /* ignore */ }
    });

    document.addEventListener('keydown', onEsc);
    document.body.classList.add('hof-welcome-open');
    document.body.appendChild(overlay);
  })();

});
