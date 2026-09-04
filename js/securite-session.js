(function () {
  "use strict";
  window.Chantier = window.Chantier || {};
  // Les données anciennes n'ont pas de propriétaire fiable : les préserver,
  // sans les réattribuer au prochain compte ni les afficher dans les packs.
  const anciennes = ["chantier_docs_infos_v1", "chantier_contrats_v1", "chantier_catalogue_v1", "chantier_catalogue_elec_v1", "chantier_catalogue_peintre_v1", "chantier_ia_key"];
  function isolerAnciennesDonnees() {
    anciennes.forEach((cle) => {
      try {
        const valeur = localStorage.getItem(cle);
        if (valeur !== null) {
          localStorage.setItem("chantier_ancien_non_attribue:" + cle, valeur);
          localStorage.removeItem(cle);
        }
      } catch (e) { console.warn("Anciennes données conservées, stockage indisponible."); }
    });
  }
  async function purgerCaches() {
    if (typeof caches === "undefined") return;
    await Promise.all((await caches.keys()).filter((cle) => cle.startsWith("chantier-") && cle !== "chantier-v41").map((cle) => caches.delete(cle)));
  }
  function purgerDemo() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("chantier_demo_pack:")) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  }
  isolerAnciennesDonnees();
  window.Chantier.securiteSession = { purgerCaches, purgerDemo };
})();
