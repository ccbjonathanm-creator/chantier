/*
 * documents.js - Documents commerciaux imprimables et liens de messagerie.
 * Aucun PDF n'est fabriqué côté client : le navigateur imprime la mise en
 * page et propose lui-même « Enregistrer en PDF ».
 */
(function () {
  "use strict";

  const S = window.Chantier = window.Chantier || {};
  const EURO = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function euro(value) { return EURO.format(Number(value) || 0); }

  function dateFR(value) {
    if (!value) return "Non renseignée";
    const date = new Date(String(value).length === 10 ? value + "T12:00:00" : value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function referenceDevis(devis) {
    const date = new Date(devis.createdAt || Date.now());
    const annee = isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
    const suffixe = String(devis.id || "DEVIS").replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase() || "DEVIS";
    return "D" + annee + "-" + suffixe;
  }

  function normaliserTiers(tiers) {
    const t = tiers || {};
    const adresse1 = t.adresse || t.billingAddressLine1 || t.billing_address_line1 || "";
    const adresse2 = t.billingAddressLine2 || t.billing_address_line2 || "";
    const codePostal = t.codePostal || t.billingPostalCode || t.billing_postal_code || "";
    const ville = t.ville || t.billingCity || t.billing_city || "";
    return {
      nom: t.nom || t.displayName || t.display_name || t.legalName || t.legal_name || "",
      raisonSociale: t.legalName || t.legal_name || "",
      siret: t.siret || t.siren || "",
      tva: t.tva || t.vatNumber || t.vat_number || "",
      adresse: [adresse1, adresse2].filter(Boolean).join(", "),
      localite: [codePostal, ville].filter(Boolean).join(" "),
      kind: t.kind || "individual",
    };
  }

  function composerMailto(destinataire, objet, corps) {
    const email = String(destinataire || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Indiquez une adresse e-mail valide pour ouvrir la messagerie.");
    }
    return "mailto:" + encodeURIComponent(email)
      + "?subject=" + encodeURIComponent(String(objet || ""))
      + "&body=" + encodeURIComponent(String(corps || ""));
  }

  function documentHTML(document) {
    const d = document || {};
    const vendeur = normaliserTiers(d.vendeur);
    const client = normaliserTiers(d.client);
    const lignes = Array.isArray(d.lignes) ? d.lignes : [];
    const incomplets = [];
    if (!vendeur.nom) incomplets.push("nom du vendeur");
    if (!vendeur.siret) incomplets.push("SIRET");
    if (!vendeur.adresse || !vendeur.localite) incomplets.push("adresse complète du vendeur");
    if (!client.nom) incomplets.push("identité du client");
    const indemnite = Number(d.indemniteRecouvrement) || 40;
    return `
      <article class="doc-sheet doc-commerce">
        ${incomplets.length ? `<div class="doc-alerte"><strong>Document incomplet :</strong> ${esc(incomplets.join(", "))}. Complétez les paramètres avant de le remettre au client.</div>` : ""}
        <header class="doc-commerce-head">
          <div class="doc-ent">
            <div class="doc-ent-nom">${esc(vendeur.nom || "Nom du vendeur non renseigné")}</div>
            <div class="doc-ent-info">
              SIRET : ${esc(vendeur.siret || "Non renseigné")}<br>
              ${esc(vendeur.adresse || "Adresse non renseignée")}<br>
              ${esc(vendeur.localite || "Code postal et ville non renseignés")}
            </div>
          </div>
          <div class="doc-identite">
            <h1>${esc(d.titre || "Document")}</h1>
            <p><strong>N° ${esc(d.numero || "Non attribué")}</strong><br>Date : ${esc(dateFR(d.date))}</p>
          </div>
        </header>
        <section class="doc-client">
          <h2>Client</h2>
          <p><strong>${esc(client.raisonSociale || client.nom || "Non renseigné")}</strong>${client.raisonSociale && client.nom !== client.raisonSociale ? `<br>${esc(client.nom)}` : ""}<br>
          ${esc(client.adresse || "Adresse non renseignée")}<br>${esc(client.localite || "Code postal et ville non renseignés")}</p>
        </section>
        ${d.objet ? `<p class="doc-objet"><strong>Objet :</strong> ${esc(d.objet)}</p>` : ""}
        <table class="doc-lignes">
          <thead><tr><th>Désignation</th><th>Qté</th><th>Unité</th><th>Prix HT</th><th>TVA</th><th>Total HT</th></tr></thead>
          <tbody>${lignes.map((ligne) => {
            const quantite = Number(ligne.quantite) || 0;
            const prix = Number(ligne.prixUnitaireHT) || 0;
            return `<tr><td><strong>${esc(ligne.libelle || ligne.libelleSnapshot || "")}</strong>${ligne.description || ligne.descriptionSnapshot ? `<small>${esc(ligne.description || ligne.descriptionSnapshot)}</small>` : ""}</td><td>${esc(quantite)}</td><td>${esc(ligne.unite || ligne.uniteSnapshot || "u")}</td><td>${esc(euro(prix))}</td><td>${esc(Number(ligne.tauxTVA) || 0)} %</td><td>${esc(euro(quantite * prix))}</td></tr>`;
          }).join("")}</tbody>
        </table>
        <section class="doc-totaux-commerce">
          <p><span>Total HT</span><strong>${esc(euro(d.totalHT))}</strong></p>
          <p><span>TVA</span><strong>${esc(euro(d.totalTVA))}</strong></p>
          <p class="doc-total-ttc"><span>Total TTC</span><strong>${esc(euro(d.totalTTC))}</strong></p>
        </section>
        <section class="doc-mentions">
          <p><strong>Conditions de paiement :</strong> ${esc(d.conditionsPaiement || "Non renseignées")}</p>
          <p><strong>Pénalités de retard :</strong> ${esc(d.penalitesRetard || "Non renseignées")}</p>
          <p><strong>Indemnité de recouvrement :</strong> ${esc(euro(indemnite))} pour frais de recouvrement, applicable aux clients professionnels.</p>
          <p><strong>TVA :</strong> ${esc(d.mentionTva || "TVA détaillée ligne par ligne ci-dessus.")}</p>
        </section>
      </article>`;
  }

  function ouvrir(document) {
    const template = window.document.createElement("template");
    template.innerHTML = `<div class="doc-overlay">
      <div class="doc-actions">
        <button class="ghost2" data-doc-fermer type="button">&lsaquo; Fermer</button>
        <button class="primary" data-doc-imprimer type="button">Imprimer / Enregistrer en PDF</button>
      </div>
      ${documentHTML(document)}
    </div>`;
    const overlay = template.content.firstElementChild;
    const fermer = () => { overlay.remove(); window.document.body.style.overflow = ""; };
    overlay.querySelector("[data-doc-fermer]").addEventListener("click", fermer);
    overlay.querySelector("[data-doc-imprimer]").addEventListener("click", () => window.print());
    window.document.body.appendChild(overlay);
    window.document.body.style.overflow = "hidden";
    return overlay;
  }

  S.documents = { composerMailto, dateFR, documentHTML, normaliserTiers, ouvrir, referenceDevis };
})();
