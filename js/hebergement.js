(function () {
  "use strict";
  if (window.top !== window.self) {
    // Défense complémentaire pour l'ancienne URL et les caches d'installation.
    document.documentElement.hidden = true;
    window.ChantierCadreInterdit = true;
    return;
  }
  const hote = "clicchantier.contactweb71.workers.dev";
  if (location.hostname === "ccbjonathanm-creator.github.io") {
    const destination = new URL(location.pathname + location.search + location.hash, "https://" + hote);
    try {
      if (localStorage.getItem("chantier_backend") === "supabase") destination.searchParams.set("entreprise", "1");
      // Confirmation d'une inscription commencée avant le changement d'hôte.
      // Le fragment n'est envoyé ni au serveur ni dans l'en-tête Referer.
      const attente = localStorage.getItem("chantier_inscription_en_attente");
      if (attente && attente.length < 2000) { const fragment = new URLSearchParams(destination.hash.slice(1)); fragment.set("reprise_inscription", attente); destination.hash = fragment.toString(); }
    } catch (_) {}
    window.ChantierCadreInterdit = true;
    // L'ancienne installation ne doit conserver aucune réponse privée v40.
    // Mettre aussi à jour son worker pour les autres onglets encore ouverts.
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/chantier/sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
    const purge = typeof caches === 'undefined' ? Promise.resolve() : caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('chantier-')).map(k => caches.delete(k))));
    purge.catch(() => {}).finally(() => location.replace(destination.href));
  } else if (location.hostname === hote) {
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (fragment.has("reprise_inscription")) {
      try {
        const attente = JSON.parse(fragment.get("reprise_inscription"));
        if (["patron", "employe"].includes(attente.type) && typeof attente.nom === "string") localStorage.setItem("chantier_inscription_en_attente", JSON.stringify({ type: attente.type, nom: attente.nom.slice(0,200), nomEntreprise: String(attente.nomEntreprise || "").slice(0,200), code: String(attente.code || "").slice(0,30) }));
      } catch (_) {}
      fragment.delete("reprise_inscription");
      history.replaceState(null, "", location.pathname + location.search + (fragment.size ? "#" + fragment.toString() : ""));
    }
  }
})();
