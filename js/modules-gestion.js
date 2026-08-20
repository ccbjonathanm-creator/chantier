/*
 * modules-gestion.js - Modules de gestion intégrés à ClicChantier.
 * Aucun code distant. Les pages sont enregistrées sur window.Chantier.
 */
(function () {
  "use strict";

  const S = window.Chantier = window.Chantier || {};

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function euro(value) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })
      .format(Number(value) || 0);
  }

  function toast(message) {
    if (typeof S.toast === "function") S.toast(message);
  }

  // Le stock vit dans le journal append-only du PALIER 4, plus dans le
  // navigateur. Le module fonctionne donc en cloud comme en demonstration.
  async function pageStock() {
    const api = S.api;
    const [articles, emplacements, niveaux, mouvements] = await Promise.all([
      api.listCatalogItems(), api.listEmplacements(), api.niveauxStock(), api.listMouvementsStock(),
    ]);
    const nomArticle = (id) => (articles.find((a) => a.id === id) || {}).label || "Article supprimé";
    const nomEmpl = (id) => (emplacements.find((e) => e.id === id) || {}).libelle || "Emplacement supprimé";

    const root = el(`
      <section class="module-page">
        <div class="module-head">
          <button class="ghost2" data-retour>&lsaquo; Modules</button>
          <div><p class="eyebrow">Module</p><h1>Stock et matériaux</h1>
          <p>Chaque mouvement est conservé. Une erreur se corrige par une annulation qui laisse sa trace.</p></div>
        </div>
        <div class="module-kpis" data-kpis></div>
        <div class="module-card">
          <h2>Enregistrer un mouvement</h2>
          <form class="module-form" data-form>
            <label>Article<select name="catalogItemId" required>${articles.map((a) => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join("")}</select></label>
            <label>Emplacement<select name="emplacementId" required>${emplacements.map((e) => `<option value="${esc(e.id)}">${esc(e.libelle)}</option>`).join("")}</select></label>
            <label>Nature<select name="type" required>
              <option value="entree">Entrée en stock</option>
              <option value="retour">Retour de chantier</option>
              <option value="correction">Correction d'inventaire</option>
            </select></label>
            <label>Quantité<input name="quantite" type="number" step="0.01" value="1" required></label>
            <label>Prix unitaire €<input name="prixUnitaire" type="number" min="0" step="0.01" value="0"></label>
            <label>Motif<input name="motif" placeholder="Facultatif"></label>
            <button class="primary" type="submit">Enregistrer</button>
          </form>
          <p class="reg-hint">La consommation sur un chantier se déclare depuis le chantier, pas ici : c'est elle qui alimentera la facture réelle.</p>
        </div>
        <div class="module-card">
          <div class="module-card-title"><h2>Niveaux</h2><span data-count></span></div>
          <div class="module-list-table" data-list></div>
        </div>
        <div class="module-card">
          <div class="module-card-title"><h2>Journal</h2><span>${mouvements.length}</span></div>
          <div class="module-list-table" data-journal></div>
        </div>
      </section>
    `);

    if (!articles.length || !emplacements.length) {
      root.querySelector("[data-form]").innerHTML =
        "<p class=\"empty\">Créez d'abord un article de catalogue et un emplacement.</p>";
    }

    const valeurTotale = niveaux.reduce((s, n) => s + Number(n.valeur), 0);
    const negatifs = niveaux.filter((n) => Number(n.quantite) < 0).length;
    root.querySelector("[data-kpis]").innerHTML = `
      <div class="module-kpi"><span>Valeur du stock</span><strong>${euro(valeurTotale)}</strong></div>
      <div class="module-kpi ${negatifs ? "danger" : ""}"><span>Niveaux négatifs</span><strong>${negatifs}</strong></div>
      <div class="module-kpi"><span>Références</span><strong>${niveaux.length}</strong></div>`;

    root.querySelector("[data-count]").textContent =
      niveaux.length + " référence" + (niveaux.length > 1 ? "s" : "");
    root.querySelector("[data-list]").innerHTML = niveaux.length ? niveaux.map((n) => {
      const negatif = Number(n.quantite) < 0;
      return `<div class="stock-row ${negatif ? "alerte" : ""}">
        <div class="stock-main"><strong>${esc(nomArticle(n.catalogItemId))}</strong><span>${esc(nomEmpl(n.emplacementId))}</span></div>
        <div class="stock-level"><span class="mod-badge ${negatif ? "lock" : "ok"}">${negatif ? "Niveau négatif" : "En stock"}</span>
          <strong>${Number(n.quantite)}</strong><small>${euro(n.valeur)}</small></div>
      </div>`;
    }).join("") : '<p class="empty">Aucun mouvement enregistré.</p>';

    const NATURE = { entree: "Entrée", consommation: "Consommation", retour: "Retour", correction: "Correction", transfert: "Transfert" };
    const compenses = mouvements.filter((m) => m.compenseId).map((m) => m.compenseId);
    root.querySelector("[data-journal]").innerHTML = mouvements.length ? mouvements.map((m) => {
      const annule = compenses.indexOf(m.id) !== -1;
      const estCompensation = !!m.compenseId;
      return `<div class="stock-row">
        <div class="stock-main"><strong>${esc(nomArticle(m.catalogItemId))}</strong>
          <span>${NATURE[m.type] || m.type} · ${esc(String(m.createdAt).slice(0, 10))}${m.motif ? " · " + esc(m.motif) : ""}</span></div>
        <div class="stock-level"><strong>${Number(m.quantite) > 0 ? "+" : ""}${Number(m.quantite)}</strong>
          ${annule ? '<span class="mod-badge lock">Annulé</span>' : estCompensation ? '<span class="mod-badge">Annulation</span>' : ""}</div>
        <div class="stock-actions">
          ${(annule || estCompensation) ? "" : '<button type="button" class="danger-text" data-annuler="' + esc(m.id) + '">Annuler</button>'}
        </div>
      </div>`;
    }).join("") : '<p class="empty">Journal vide.</p>';

    root.querySelectorAll("[data-annuler]").forEach((b) => {
      b.addEventListener("click", async () => {
        const motif = prompt("Motif de l'annulation ?", "Erreur de saisie");
        if (motif === null) return;
        try {
          await api.annulerMouvementStock(b.dataset.annuler, motif, S.moiId ? S.moiId() : null);
          S.rerender();
        } catch (e) { alert(e.message); }
      });
    });

    const form = root.querySelector("[data-form]");
    if (form && form.elements.catalogItemId) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const d = new FormData(form);
        try {
          await api.ajouterMouvementStock({
            catalogItemId: d.get("catalogItemId"),
            emplacementId: d.get("emplacementId"),
            type: d.get("type"),
            quantite: Number(d.get("quantite")),
            prixUnitaire: Number(d.get("prixUnitaire")) || null,
            motif: d.get("motif") || "",
            creePar: S.moiId ? S.moiId() : null,
          });
          toast("Mouvement enregistré.");
          S.rerender();
        } catch (e) { alert(e.message); }
      });
    }

    root.querySelector("[data-retour]").addEventListener("click", () => S.allerModules());
    return root;
  }


  // La rentabilite ne se saisit plus a la main : elle se LIT sur les
  // chantiers reels, heures pointees et materiaux consommes.
  async function pageRentabilite() {
    const api = S.api;
    const [devisTous, clients] = await Promise.all([api.listDevis(), api.listClients()]);
    const acceptes = devisTous.filter((d) => d.statut === "accepte");
    const nomClient = (id) => (clients.find((c) => c.id === id) || {}).displayName || "Client";

    const root = el(`
      <section class="module-page">
        <div class="module-head">
          <button class="ghost2" data-retour>&lsaquo; Modules</button>
          <div><p class="eyebrow">Module</p><h1>Rentabilité</h1>
          <p>Ce que chaque chantier a réellement rapporté, heures pointées et matériaux consommés compris.</p></div>
        </div>
        <div class="module-card">
          <div class="module-card-title"><h2>Chantiers en cours</h2><span>${acceptes.length}</span></div>
          <div data-liste></div>
        </div>
        <div data-detail></div>
      </section>
    `);

    const liste = root.querySelector("[data-liste]");
    if (!acceptes.length) {
      liste.innerHTML = '<p class="empty">Aucun devis accepté. La rentabilité se calcule sur un chantier réel.</p>';
    }
    acceptes.forEach((d) => {
      const carte = el(`
        <button class="socle-card" type="button">
          <span><strong>${esc(d.titre)}</strong><small>${esc(nomClient(d.clientId))} · devis ${euro(d.totalTTC)} TTC</small></span>
          <span class="chev">&rsaquo;</span>
        </button>`);
      carte.addEventListener("click", async () => {
        const detail = root.querySelector("[data-detail]");
        detail.innerHTML = '<div class="module-card"><p class="reg-hint">Calcul en cours…</p></div>';
        try {
          const p = await api.proposerFactureReelle(d.id);
          const r = p.rentabilite;
          const perte = r.marge < 0;
          detail.innerHTML = `
            <div class="module-kpis">
              <div class="module-kpi"><span>Chiffre d'affaires réel</span><strong>${euro(r.chiffreAffairesHT)}</strong></div>
              <div class="module-kpi ${perte ? "danger" : ""}"><span>Marge</span><strong>${euro(r.marge)}</strong></div>
              <div class="module-kpi ${r.tauxMarge < 15 ? "danger" : ""}"><span>Taux de marge</span><strong>${String(r.tauxMarge).replace(".", ",")} %</strong></div>
            </div>
            <div class="module-card module-explication">
              <h2>${esc(d.titre)}</h2>
              <p><strong>${p.reel.heuresReelles}</strong> heure${p.reel.heuresReelles > 1 ? "s" : ""} pointée${p.reel.heuresReelles > 1 ? "s" : ""},
                 coût interne <strong>${euro(r.coutMainOeuvre)}</strong>. Matériaux consommés :
                 <strong>${euro(r.coutMateriaux)}</strong>.</p>
              <p>Devis signé <strong>${euro(p.totalDevis.ht)}</strong> HT, réel facturable <strong>${euro(p.totalReel.ht)}</strong> HT.</p>
              ${p.ecarts.length ? '<div class="module-warning">' + p.ecarts.map((e) => esc(e.libelle)).join("<br>") + "</div>" : ""}
            </div>`;
        } catch (e) {
          detail.innerHTML = '<div class="module-card"><p class="empty">' + esc(e.message) + "</p></div>";
        }
      });
      liste.appendChild(carte);
    });

    root.querySelector("[data-retour]").addEventListener("click", () => S.allerModules());
    return root;
  }


  function pageInformation(code, titre, texte, action) {
    return async function () {
      const root = el(`
        <section class="module-page">
          <div class="module-head">
            <button class="ghost2" data-retour>&lsaquo; Modules</button>
            <div><p class="eyebrow">Module</p><h1>${esc(titre)}</h1><p>${esc(texte)}</p></div>
          </div>
          <div class="module-card module-progress">
            <span class="mod-badge ok">Intégré à ClicChantier</span>
            <h2>${esc(action.titre)}</h2>
            <p>${esc(action.texte)}</p>
            ${action.bouton ? '<button class="primary" data-action>' + esc(action.bouton) + "</button>" : ""}
          </div>
        </section>
      `);
      root.querySelector("[data-retour]").addEventListener("click", () => S.allerModules());
      const button = root.querySelector("[data-action]");
      if (button && action.executer) button.addEventListener("click", action.executer);
      return root;
    };
  }

  S.stock = { page: pageStock, reset() {} };
  S.profitability = { page: pageRentabilite, reset() {} };
  // PALIER 6 : l'artisan raconte, l'application STRUCTURE, il valide.
  // La differance avec le suivi de chantier existant : ici, ce qui est
  // extrait alimente le stock et la facture, ce n'est pas que du texte.
  async function pageCompteRendu() {
    const api = S.api;
    const [interventions, articles] = await Promise.all([
      api.listInterventions({}), api.listCatalogItems(),
    ]);
    const root = el(`
      <section class="module-page">
        <div class="module-head">
          <button class="ghost2" data-retour>&lsaquo; Modules</button>
          <div><p class="eyebrow">Module</p><h1>Compte rendu vocal</h1>
          <p>Racontez votre intervention. L'application en tire une fiche à valider, elle ne décide de rien.</p></div>
        </div>
        <div class="module-card">
          <div class="module-form">
            <label>Chantier<select data-chantier>${interventions.map((i) => `<option value="${esc(i.id)}">${esc(i.client || "Chantier")} · ${esc(i.date)}</option>`).join("")}</select></label>
            <label>Ce que vous avez fait<textarea data-texte rows="5" placeholder="Ex : j'ai posé 3 robinetteries, passé 4 heures sur place, il faudra repasser pour le joint."></textarea></label>
          </div>
          <button class="primary" data-analyser type="button">Structurer le compte rendu</button>
        </div>
        <div data-resultat></div>
      </section>
    `);

    if (!interventions.length) {
      root.querySelector("[data-analyser]").disabled = true;
    }

    root.querySelector("[data-analyser]").addEventListener("click", async () => {
      const texte = root.querySelector("[data-texte]").value;
      const zone = root.querySelector("[data-resultat]");
      const chantierId = root.querySelector("[data-chantier]").value;
      try {
        const prop = await S.proposition.proposer("compte_rendu", { texte, catalogue: articles });
        if (prop.question) { zone.innerHTML = '<div class="module-card"><p class="empty">' + esc(prop.question) + "</p></div>"; return; }

        const CONF = { certain: ["Certain", "ok"], probable: ["Probable", ""], a_verifier: ["À vérifier", "lock"] };
        zone.innerHTML = `
          <div class="module-card">
            <div class="module-card-title"><h2>Fiche à valider</h2><span>${esc(prop.resume)}</span></div>
            <div data-champs>${prop.champs.map((c, i) => {
              const cf = CONF[c.confiance] || ["", ""];
              const q = c.cle === "materiau" ? ` · quantité ${c.quantite}` : "";
              // Un booléen ne s'affiche pas « true » à un artisan.
              const lu = typeof c.valeur === "boolean"
                ? (c.valeur ? "Oui" : "Non")
                : String(c.valeur);
              return `<div class="reconcile-card">
                <label class="reel-ligne">
                  <input type="checkbox" checked data-champ="${i}">
                  <span class="reconcile-main"><strong>${esc(c.libelle)}</strong>
                    <span>${esc(lu).slice(0, 160)}${q}</span>
                    <span class="mod-desc">${esc(c.motif)}</span></span>
                  <span class="mod-badge ${cf[1]}">${cf[0]}</span>
                </label>
              </div>`;
            }).join("")}</div>
            <div class="devis-actions">
              <button class="primary" data-valider type="button">Valider et enregistrer</button>
            </div>
            <p class="reg-hint">Rien n'est enregistré tant que vous n'avez pas validé. Décochez ce qui est faux.</p>
          </div>`;

        zone.querySelector("[data-valider]").addEventListener("click", async () => {
          const retenus = [];
          zone.querySelectorAll("[data-champ]").forEach((c) => {
            if (c.checked) retenus.push(prop.champs[Number(c.dataset.champ)]);
          });
          if (!retenus.length) { alert("Cochez au moins un élément."); return; }
          try {
            const recit = retenus.find((c) => c.cle === "recit");
            if (recit) await api.ajouterNote(chantierId, { texte: String(recit.valeur), brut: texte, parIA: true, employeId: S.moiId ? S.moiId() : null });
            // Les matériaux validés deviennent de VRAIES consommations.
            const emplacements = await api.listEmplacements();
            for (const c of retenus.filter((x) => x.cle === "materiau" && x.catalogItemId)) {
              const art = articles.find((a) => a.id === c.catalogItemId);
              await api.ajouterMouvementStock({
                catalogItemId: c.catalogItemId,
                emplacementId: emplacements[0].id,
                type: "consommation",
                quantite: -Math.abs(Number(c.quantite) || 1),
                prixUnitaire: art ? Number(art.purchasePriceExclTax || art.unitPriceExclTax) : null,
                interventionId: chantierId,
                creePar: S.moiId ? S.moiId() : null,
              });
            }
            alert("Compte rendu enregistré.");
            S.rerender();
          } catch (e) { alert(e.message); }
        });
      } catch (e) { zone.innerHTML = '<div class="module-card"><p class="empty">' + esc(e.message) + "</p></div>"; }
    });

    root.querySelector("[data-retour]").addEventListener("click", () => S.allerModules());
    return root;
  }

  S.voice = { page: pageCompteRendu, reset() {} };
  S.billing = {
    page: pageInformation("billing", "Facturation Factur-X", "Le moteur Factur-X validé de Facturier va être porté ici sans raccourcir la chaîne préparer, vérifier, émettre.", {
      titre: "Portage sécurisé en cours",
      texte: "Aucune facture fictive ni numérotation locale ne sera utilisée. L'émission restera autoritative côté serveur.",
    }),
    reset() {},
  };
  // PALIER 7 : import du justificatif, champs proposés, VALIDATION
  // HUMAINE, et c'est seulement là que le stock bouge.
  async function pageFacturesFournisseurs() {
    const api = S.api;
    const [docs, articles, emplacements] = await Promise.all([
      api.listFacturesFournisseurs(), api.listCatalogItems(), api.listEmplacements(),
    ]);
    const STATUT = {
      importe: ["Importé", "lock"], extrait: ["À valider", "lock"],
      valide: ["Validé", "ok"], rejete: ["Rejeté", "lock"],
    };

    const root = el(`
      <section class="module-page">
        <div class="module-head">
          <button class="ghost2" data-retour>&lsaquo; Modules</button>
          <div><p class="eyebrow">Module</p><h1>Factures fournisseurs</h1>
          <p>Importez le justificatif, vérifiez ce qui en est tiré, puis validez. Rien n'entre en stock avant votre accord.</p></div>
        </div>
        <div class="module-card">
          <h2>Importer un justificatif</h2>
          <form class="module-form" data-import>
            <label>Fichier (PDF, JPEG, PNG ou WebP, 20 Mo au maximum)
              <input type="file" name="fichier" accept=".pdf,image/jpeg,image/png,image/webp" required></label>
            <button class="primary" type="submit">Importer</button>
          </form>
          <p class="reg-hint">Le fichier reste sur votre appareil. Aucune lecture automatique n'est branchée pour l'instant : vous saisissez vous-même ce que contient la facture.</p>
        </div>
        <div class="module-card">
          <div class="module-card-title"><h2>Documents</h2><span>${docs.length}</span></div>
          <div data-liste></div>
        </div>
        <div data-detail></div>
      </section>
    `);

    const liste = root.querySelector("[data-liste]");
    if (!docs.length) liste.innerHTML = '<p class="empty">Aucun justificatif importé.</p>';
    docs.forEach((d) => {
      const st = STATUT[d.statut] || [d.statut, ""];
      const carte = el(`
        <button class="socle-card" type="button">
          <span><strong>${esc(d.nomFichier)}</strong>
            <small>${esc(d.fournisseur || "Fournisseur à renseigner")}${d.totalTTC != null ? " · " + euro(d.totalTTC) : ""}</small></span>
          <span class="mod-badge ${st[1]}">${st[0]}</span>
        </button>`);
      carte.addEventListener("click", () => ouvrir(d.id));
      liste.appendChild(carte);
    });

    async function ouvrir(id) {
      const d = await api.getFactureFournisseur(id);
      const detail = root.querySelector("[data-detail]");
      if (d.statut === "valide" || d.statut === "rejete") {
        detail.innerHTML = `<div class="module-card"><h2>${esc(d.nomFichier)}</h2>
          <p class="reg-hint">${d.statut === "valide"
            ? "Document validé et figé. Les lignes rattachées sont entrées en stock."
            : "Document rejeté : " + esc(d.motifRejet)}</p></div>`;
        return;
      }
      const l0 = d.lignes[0];
      detail.innerHTML = `
        <div class="module-card">
          <h2>Ce que contient ${esc(d.nomFichier)}</h2>
          <form class="module-form" data-saisie>
            <label>Fournisseur<input name="fournisseur" value="${esc(d.fournisseur)}" required></label>
            <label>Numéro de pièce<input name="numeroPiece" value="${esc(d.numeroPiece)}"></label>
            <label>Total TTC €<input name="totalTTC" type="number" min="0" step="0.01" value="${d.totalTTC == null ? "" : d.totalTTC}"></label>
            <label>Article reçu<select name="catalogItemId">
              <option value="">Aucun article du catalogue</option>
              ${articles.map((a) => `<option value="${esc(a.id)}" ${l0 && l0.catalogItemId === a.id ? "selected" : ""}>${esc(a.label)}</option>`).join("")}
            </select></label>
            <label>Quantité<input name="quantite" type="number" min="0.01" step="0.01" value="${l0 ? l0.quantite : 1}"></label>
            <label>Prix unitaire d'achat €<input name="prixUnitaire" type="number" min="0" step="0.01" value="${l0 ? l0.prixUnitaire : 0}"></label>
            <button class="primary" type="submit">Enregistrer ce que j'ai lu</button>
          </form>
        </div>
        ${d.statut === "extrait" ? `
        <div class="module-card">
          <h2>Validation</h2>
          <div class="module-form">
            <label>Emplacement de réception<select data-empl>${emplacements.map((e) => `<option value="${esc(e.id)}">${esc(e.libelle)}</option>`).join("")}</select></label>
          </div>
          <div class="devis-actions">
            <button class="primary" data-valider type="button">Valider et entrer en stock</button>
            <button class="ghost2" data-rejeter type="button">Rejeter</button>
          </div>
          <p class="reg-hint">La validation crée les entrées de stock et fige le document. Elle est définitive.</p>
        </div>` : ""}`;

      detail.querySelector("[data-saisie]").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target);
        try {
          await api.enregistrerExtraction(id, {
            fournisseur: f.get("fournisseur"), numeroPiece: f.get("numeroPiece"),
            totalTTC: f.get("totalTTC") === "" ? null : Number(f.get("totalTTC")),
            confiances: { fournisseur: "certain", totalTTC: "certain" },
            lignes: [{
              libelle: f.get("fournisseur") + " · réception",
              quantite: Number(f.get("quantite")) || 1,
              prixUnitaire: Number(f.get("prixUnitaire")) || 0,
              catalogItemId: f.get("catalogItemId") || null,
              confiance: "certain",
            }],
          });
          S.rerender();
        } catch (e) { alert(e.message); }
      });

      const bv = detail.querySelector("[data-valider]");
      if (bv) bv.addEventListener("click", async () => {
        if (!confirm("Valider ce justificatif ? Les articles rattachés entreront en stock, et le document sera figé.")) return;
        try {
          await api.validerFactureFournisseur(id, {
            emplacementId: detail.querySelector("[data-empl]").value,
            accepterOrphelines: true,
            auteurId: S.moiId ? S.moiId() : null,
          });
          S.rerender();
        } catch (e) { alert(e.message); }
      });

      const br = detail.querySelector("[data-rejeter]");
      if (br) br.addEventListener("click", async () => {
        const motif = prompt("Motif du rejet ?", "Facture en double");
        if (motif === null) return;
        try { await api.rejeterFactureFournisseur(id, motif); S.rerender(); }
        catch (e) { alert(e.message); }
      });
    }

    root.querySelector("[data-import]").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const input = ev.target.elements.fichier;
      const fichier = input.files && input.files[0];
      if (!fichier) return;
      try {
        await api.importerFactureFournisseur({
          nom: fichier.name, typeMime: fichier.type, tailleOctets: fichier.size,
        });
        S.rerender();
      } catch (e) { alert(e.message); }
    });

    root.querySelector("[data-retour]").addEventListener("click", () => S.allerModules());
    return root;
  }

  S.supplier_invoices = { page: pageFacturesFournisseurs, reset() {} };
})();
