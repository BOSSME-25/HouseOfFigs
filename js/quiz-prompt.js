/* ============================================
   House of Figs — Quiz Prompt
   Persistent floating prompt on all pages
   except the quiz page itself.
   ============================================ */

(function () {
  // Don't show on the quiz page
  if (window.location.pathname.indexOf('quiz') !== -1) return;

  // Check if user dismissed this session
  if (sessionStorage.getItem('hof_quiz_dismissed')) return;

  // Build the prompt HTML
  var prompt = document.createElement('div');
  prompt.id = 'quiz-prompt';
  prompt.innerHTML =
    '<div class="quiz-prompt-inner">' +
      '<button class="quiz-prompt-close" aria-label="Close quiz prompt">&times;</button>' +
      '<div class="quiz-prompt-icon">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="28" height="28">' +
          '<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>' +
          '<path d="M9 9a3 3 0 0 1 5.12-2.13A3 3 0 0 1 12 13"/>' +
          '<circle cx="12" cy="17" r="0.5"/>' +
        '</svg>' +
      '</div>' +
      '<div class="quiz-prompt-content">' +
        '<p class="quiz-prompt-heading">What is your plate telling you?</p>' +
        '<p class="quiz-prompt-text">Take a quick 2-minute quiz to discover which nutrients your body may be missing.</p>' +
      '</div>' +
      '<a href="quiz.html" class="quiz-prompt-btn">Take the Quiz</a>' +
    '</div>';

  // Build the styles
  var style = document.createElement('style');
  style.textContent =
    '#quiz-prompt {' +
      'position: fixed;' +
      'bottom: 24px;' +
      'right: 24px;' +
      'z-index: 9999;' +
      'max-width: 380px;' +
      'width: calc(100% - 48px);' +
      'opacity: 0;' +
      'transform: translateY(20px);' +
      'transition: opacity 0.5s ease, transform 0.5s ease;' +
      'pointer-events: none;' +
    '}' +
    '#quiz-prompt.visible {' +
      'opacity: 1;' +
      'transform: translateY(0);' +
      'pointer-events: auto;' +
    '}' +
    '.quiz-prompt-inner {' +
      'background-color: #4A3728;' +
      'border-radius: 12px;' +
      'padding: 1.5rem;' +
      'box-shadow: 0 12px 40px rgba(74, 55, 40, 0.25), 0 4px 12px rgba(0,0,0,0.1);' +
      'position: relative;' +
      'display: flex;' +
      'flex-direction: column;' +
      'gap: 1rem;' +
    '}' +
    '.quiz-prompt-close {' +
      'position: absolute;' +
      'top: 10px;' +
      'right: 12px;' +
      'background: none;' +
      'border: none;' +
      'color: rgba(245, 240, 234, 0.5);' +
      'font-size: 1.375rem;' +
      'cursor: pointer;' +
      'padding: 4px;' +
      'line-height: 1;' +
      'transition: color 0.2s;' +
    '}' +
    '.quiz-prompt-close:hover {' +
      'color: rgba(245, 240, 234, 0.9);' +
    '}' +
    '.quiz-prompt-icon {' +
      'color: #8B5E5A;' +
    '}' +
    '.quiz-prompt-content {' +
      'display: flex;' +
      'flex-direction: column;' +
      'gap: 0.375rem;' +
    '}' +
    '.quiz-prompt-heading {' +
      'font-family: "Cormorant Garamond", Georgia, serif;' +
      'font-size: 1.25rem;' +
      'font-weight: 500;' +
      'color: #F5F0EA;' +
      'line-height: 1.3;' +
      'margin: 0;' +
    '}' +
    '.quiz-prompt-text {' +
      'font-family: "Inter", sans-serif;' +
      'font-size: 0.875rem;' +
      'color: rgba(245, 240, 234, 0.65);' +
      'line-height: 1.6;' +
      'margin: 0;' +
    '}' +
    '.quiz-prompt-btn {' +
      'display: inline-block;' +
      'align-self: flex-start;' +
      'background-color: #8B5E5A;' +
      'color: #FFFFFF;' +
      'font-family: "Inter", sans-serif;' +
      'font-size: 0.875rem;' +
      'font-weight: 500;' +
      'padding: 0.625rem 1.5rem;' +
      'border-radius: 4px;' +
      'text-decoration: none;' +
      'letter-spacing: 0.02em;' +
      'transition: background-color 0.25s ease;' +
    '}' +
    '.quiz-prompt-btn:hover {' +
      'background-color: #6B7F5E;' +
      'color: #FFFFFF;' +
    '}' +
    '@media (max-width: 480px) {' +
      '#quiz-prompt {' +
        'bottom: 16px;' +
        'right: 16px;' +
        'max-width: none;' +
        'width: calc(100% - 32px);' +
      '}' +
      '.quiz-prompt-inner {' +
        'padding: 1.25rem;' +
      '}' +
    '}';

  document.head.appendChild(style);
  document.body.appendChild(prompt);

  // Show after a delay (3 seconds)
  setTimeout(function () {
    prompt.classList.add('visible');
  }, 3000);

  // Close button
  prompt.querySelector('.quiz-prompt-close').addEventListener('click', function () {
    prompt.classList.remove('visible');
    sessionStorage.setItem('hof_quiz_dismissed', '1');
    setTimeout(function () {
      prompt.remove();
    }, 500);
  });
})();
