(() => {
  const intercept = (selector, action) => {
    const button = document.querySelector(selector);
    if (!button) return;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const $book = window.jQuery && window.jQuery('#flipbook');
      if (!$book || !$book.data('turn')) return;
      if (button.disabled) return;
      try { $book.turn(action); } catch (error) { console.error('Flip navigation failed', error); }
    }, true);
  };
  intercept('#prev', 'previous');
  intercept('#next', 'next');
})();
