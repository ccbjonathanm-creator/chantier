(function () {
  "use strict";
  let compteur = 0;
  const ouverts = new Map();
  const focusables = '[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function visibles(dialogue) { return [...dialogue.querySelectorAll(focusables)].filter(e => e.getClientRects().length && !e.closest('[hidden],[inert]')); }
  function activer(dialogue) {
    if (ouverts.has(dialogue)) return;
    const ancien = document.activeElement;
    dialogue.setAttribute('role', 'dialog'); dialogue.setAttribute('aria-modal', 'true'); dialogue.tabIndex = -1;
    const titre = dialogue.querySelector('h1,h2,h3');
    if (titre) { if (!titre.id) titre.id = 'dialogue-titre-' + (++compteur); dialogue.setAttribute('aria-labelledby', titre.id); }
    else dialogue.setAttribute('aria-label', 'Fenêtre de saisie');
    dialogue.querySelectorAll('button.x').forEach(b => { if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', 'Fermer'); });
    function clavier(e) {
      if ([...ouverts.keys()].at(-1) !== dialogue) return;
      if (e.key === 'Escape') { const b = dialogue.querySelector('button.x,button#close,button[data-close]'); if (b) { e.preventDefault(); e.stopPropagation(); b.click(); } }
      if (e.key === 'Tab') {
        const xs = visibles(dialogue), first = xs[0], last = xs.at(-1);
        if (!xs.length) { e.preventDefault(); dialogue.focus(); }
        else if (e.shiftKey && (document.activeElement === first || !dialogue.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !dialogue.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    }
    function recentrer(e) { if ([...ouverts.keys()].at(-1) === dialogue && !dialogue.contains(e.target)) (visibles(dialogue)[0] || dialogue).focus(); }
    document.addEventListener('keydown', clavier, true); document.addEventListener('focusin', recentrer);
    ouverts.set(dialogue, () => { document.removeEventListener('keydown', clavier, true); document.removeEventListener('focusin', recentrer); if (ancien && ancien.isConnected) ancien.focus(); });
    (visibles(dialogue)[0] || dialogue).focus();
  }
  new MutationObserver(() => {
    for (const [dialogue, fermer] of ouverts) if (!dialogue.isConnected) { ouverts.delete(dialogue); fermer(); }
    document.querySelectorAll('.modal').forEach(activer);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
