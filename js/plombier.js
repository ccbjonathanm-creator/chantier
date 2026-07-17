/*
 * plombier.js - Module payant "Pack Plombier / Chauffagiste" de ClicChantier.
 *
 * Premier module METIER. Il ne s'affiche que si l'entreprise a le droit
 * "plombier" (features.actif("plombier")). Il apporte 3 briques concretes :
 *   1. Contrats d'entretien recurrents (chaudieres, chauffe-eau...) avec
 *      rappels d'echeance + bouton "Planifier" (cree un chantier) + attestation.
 *   2. Catalogue de prestations plomberie/chauffage pre-rempli et editable.
 *   3. Documents PDF : attestation d'entretien de chaudiere, attestation TVA 10%.
 *
 * Autonome : il definit ses propres helpers, lit/ecrit sa propre zone de
 * stockage (localStorage en mode demo, prete a etre branchee sur Supabase),
 * et ne depend de l'app que par window.Chantier.api, .rerender et .shared.
 */
(function () {
  "use strict";
  const S = window.Chantier = window.Chantier || {};

  // ---------- Helpers autonomes ----------
  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function addMonthsISO(iso, n) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1 + n, d);
    // Recale si le jour deborde (ex : 31 -> mois court)
    if (dt.getDate() < d) dt.setDate(0);
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  }
  function joursEntre(a, b) {
    const t1 = new Date(a + "T00:00:00").getTime();
    const t2 = new Date(b + "T00:00:00").getTime();
    return Math.round((t2 - t1) / 86400000);
  }
  const MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
  function fmtFR(iso) {
    if (!iso) return "-";
    const [y, m, d] = iso.split("-").map(Number);
    return d + " " + MOIS[m - 1] + " " + y;
  }
  function euro(n) {
    const v = Number(n) || 0;
    return v.toLocaleString("fr-FR", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }) + " €";
  }
  function uid() {
    return "p_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }
  function toast(msg) {
    const t = el(`<div class="pl-toast">${esc(msg)}</div>`);
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2600);
  }

  // ---------- Icones locales ----------
  const I = {
    wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.3l-6 6a1.5 1.5 0 0 0 2.1 2.1l6-6a4 4 0 0 0 5.3-5.4l-2.4 2.4-2.1-.6-.6-2.1z"/></svg>',
    flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2s5 4.5 5 9a5 5 0 0 1-10 0c0-1.5.6-2.8 1.4-3.8C9 9 10 8 10 6c1.5 1 2 2.5 2 4 .8-.7 1.2-1.8 0-4z"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15h6M9 11h2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/></svg>',
  };

  // ---------- Stockage (async, pret pour le cloud) ----------
  // En mode demo tout vit dans localStorage. Le jour ou on branche Supabase,
  // on remplace le corps de ces fonctions par des appels a l'API cloud.
  const K_INFOS = "chantier_docs_infos_v1";
  const K_CONTRATS = "chantier_contrats_v1";
  const K_CATALOGUE = "chantier_catalogue_v1";

  function lire(cle, repli) {
    try { const r = localStorage.getItem(cle); return r ? JSON.parse(r) : repli; } catch (e) { return repli; }
  }
  function ecrire(cle, val) {
    try { localStorage.setItem(cle, JSON.stringify(val)); } catch (e) {}
  }

  const store = {
    async infos() {
      let i = lire(K_INFOS, null);
      if (i === null) { i = { ...INFOS_DEFAUT }; ecrire(K_INFOS, i); }
      return i;
    },
    async setInfos(data) { ecrire(K_INFOS, data); return data; },

    async contrats() {
      let list = lire(K_CONTRATS, null);
      if (list === null) { list = contratsDefaut(); ecrire(K_CONTRATS, list); }
      return list;
    },
    async saveContrat(c) {
      const list = lire(K_CONTRATS, []);
      if (c.id) {
        const i = list.findIndex((x) => x.id === c.id);
        if (i >= 0) list[i] = c; else list.push(c);
      } else { c.id = uid(); list.push(c); }
      ecrire(K_CONTRATS, list);
      return c;
    },
    async deleteContrat(id) {
      ecrire(K_CONTRATS, lire(K_CONTRATS, []).filter((x) => x.id !== id));
      return true;
    },

    async catalogue() {
      let list = lire(K_CATALOGUE, null);
      if (list === null) { list = CATALOGUE_DEFAUT.map((p) => ({ ...p, id: uid() })); ecrire(K_CATALOGUE, list); }
      return list;
    },
    async savePresta(p) {
      const list = await this.catalogue();
      if (p.id) {
        const i = list.findIndex((x) => x.id === p.id);
        if (i >= 0) list[i] = p; else list.push(p);
      } else { p.id = uid(); list.push(p); }
      ecrire(K_CATALOGUE, list);
      return p;
    },
    async deletePresta(id) {
      ecrire(K_CATALOGUE, (await this.catalogue()).filter((x) => x.id !== id));
      return true;
    },
  };

  // Catalogue de prestations plomberie / chauffage pre-rempli (tarifs HT indicatifs).
  const CATALOGUE_DEFAUT = [
    { libelle: "Deplacement + diagnostic", unite: "forfait", prixHT: 45 },
    { libelle: "Main d'oeuvre plombier", unite: "heure", prixHT: 55 },
    { libelle: "Recherche de fuite", unite: "forfait", prixHT: 90 },
    { libelle: "Remplacement mitigeur evier / lavabo", unite: "unite", prixHT: 130 },
    { libelle: "Remplacement mecanisme de chasse WC", unite: "unite", prixHT: 110 },
    { libelle: "Debouchage canalisation", unite: "forfait", prixHT: 120 },
    { libelle: "Remplacement chauffe-eau electrique 200 L (pose)", unite: "forfait", prixHT: 280 },
    { libelle: "Entretien annuel chaudiere gaz", unite: "forfait", prixHT: 130 },
    { libelle: "Desembouage circuit de chauffage", unite: "forfait", prixHT: 550 },
    { libelle: "Remplacement groupe de securite", unite: "unite", prixHT: 95 },
    { libelle: "Remplacement robinet d'arret", unite: "unite", prixHT: 60 },
    { libelle: "Installation et raccordement lave-vaisselle / lave-linge", unite: "forfait", prixHT: 90 },
    { libelle: "Remplacement radiateur (pose seule)", unite: "unite", prixHT: 180 },
    { libelle: "Pose adoucisseur d'eau (pose seule)", unite: "forfait", prixHT: 350 },
    { libelle: "Detartrage chauffe-eau", unite: "forfait", prixHT: 140 },
  ];

  const TYPES_APPAREIL = ["Chaudiere gaz", "Chaudiere fioul", "Chaudiere bois / granules", "Chauffe-eau", "Pompe a chaleur", "Adoucisseur", "Climatisation", "Autre"];

  // Entreprise fictive par defaut (mode demo). Editable dans Documents > Infos.
  const INFOS_DEFAUT = {
    raisonSociale: "SARL Chauffage & Sanitaire Bourgogne",
    siret: "80123456700025",
    adresse: "12 rue des Artisans, 71200 Le Creusot",
    tel: "03 85 55 42 18",
    email: "contact@csb-plomberie.fr",
    assureur: "MAAF Pro",
    assurancePolice: "DEC-2024-77120",
    tvaIntra: "FR40801234567",
  };

  // Clients sous contrat d'entretien par defaut (mode demo), echeances variees.
  function contratsDefaut() {
    const ilYa = (mois) => addMonthsISO(todayISO(), -mois);
    return [
      { id: uid(), client: "M. et Mme Lefevre", adresse: "8 impasse des Vignes, 71200 Le Creusot", tel: "06 12 34 56 78",
        appareilType: "Chaudiere gaz", appareilMarque: "Saunier Duval", appareilModele: "ThemaPlus Condens",
        dateDernier: ilYa(13), frequenceMois: 12, montant: "135", notes: "Chaudiere au sous-sol." },
      { id: uid(), client: "Boulangerie Moreau", adresse: "3 place du Marche, 71300 Montceau-les-Mines", tel: "03 85 57 11 22",
        appareilType: "Chauffe-eau", appareilMarque: "Atlantic", appareilModele: "Chauffeo 300L",
        dateDernier: ilYa(12), frequenceMois: 12, montant: "90", notes: "Acces par l'arriere-boutique." },
      { id: uid(), client: "Mme Garnier", adresse: "25 avenue de la Republique, 71200 Le Creusot", tel: "06 98 76 54 32",
        appareilType: "Pompe a chaleur", appareilMarque: "Daikin", appareilModele: "Altherma 3",
        dateDernier: ilYa(5), frequenceMois: 12, montant: "160", notes: "PAC air/eau." },
      { id: uid(), client: "Copropriete Les Tilleuls", adresse: "15 bd H. P. Schneider, 71200 Le Creusot", tel: "03 85 00 99 11",
        appareilType: "Chaudiere fioul", appareilMarque: "De Dietrich", appareilModele: "GT 220",
        dateDernier: ilYa(10), frequenceMois: 12, montant: "220", notes: "Chaufferie collective, contacter le syndic." },
    ];
  }

  // ---------- Etat interne du module ----------
  const pstate = { section: "accueil" };
  function go(section) { pstate.section = section; S.rerender(); }
  function repaint() { S.rerender(); } // reconstruit via app.render -> page()

  // ---------- Echeances des contrats ----------
  function echeance(c) {
    if (!c.dateDernier) return { prochaine: "", etat: "inconnu", jours: null };
    const prochaine = addMonthsISO(c.dateDernier, c.frequenceMois || 12);
    const j = joursEntre(todayISO(), prochaine);
    let etat = "ok";
    if (j < 0) etat = "retard";
    else if (j <= 30) etat = "bientot";
    return { prochaine, etat, jours: j };
  }

  // =====================================================================
  //  PAGE : renvoie le noeud de la section courante (montee par shell())
  // =====================================================================
  async function page() {
    if (pstate.section === "contrats") return await sectionContrats();
    if (pstate.section === "catalogue") return await sectionCatalogue();
    if (pstate.section === "documents") return await sectionDocuments();
    return await sectionAccueil();
  }

  function enteteSection(titre, sousTitre, retour) {
    const h = el(`
      <div class="pl-head">
        ${retour ? `<button class="pl-back" id="pl-back">&lsaquo; Retour</button>` : ""}
        <div class="pl-head-txt"><h2>${esc(titre)}</h2><p>${esc(sousTitre)}</p></div>
      </div>
    `);
    if (retour) h.querySelector("#pl-back").addEventListener("click", () => go("accueil"));
    return h;
  }

  // ---------- Section ACCUEIL ----------
  async function sectionAccueil() {
    const contrats = await store.contrats();
    const infos = await store.infos();
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Pack Plomberie / Chauffage", "Vos outils metier", false));

    // Bandeau de rappels d'entretien
    const dus = contrats.map((c) => ({ c, e: echeance(c) }))
      .filter((x) => x.e.etat === "retard" || x.e.etat === "bientot")
      .sort((a, b) => (a.e.prochaine || "9").localeCompare(b.e.prochaine || "9"));
    if (dus.length) {
      const banner = el(`<div class="pl-rappels"><div class="pl-rappels-t">${I.bell} Entretiens a prevoir</div></div>`);
      dus.slice(0, 4).forEach(({ c, e }) => {
        const txt = e.etat === "retard"
          ? `en retard depuis le ${fmtFR(e.prochaine)}`
          : `a faire avant le ${fmtFR(e.prochaine)} (dans ${e.jours} j)`;
        const row = el(`
          <button class="pl-rappel ${e.etat}">
            <span class="pl-rappel-c">${esc(c.client)}</span>
            <span class="pl-rappel-d">${esc(c.appareilType || "Entretien")} &middot; ${txt}</span>
          </button>`);
        row.addEventListener("click", () => go("contrats"));
        banner.appendChild(row);
      });
      cont.appendChild(banner);
    }

    // Cartes de navigation
    const grid = el(`<div class="pl-cards"></div>`);
    grid.appendChild(carteNav(I.wrench, "Contrats d'entretien", `${contrats.length} contrat${contrats.length > 1 ? "s" : ""} suivi${contrats.length > 1 ? "s" : ""}`, () => go("contrats")));
    grid.appendChild(carteNav(I.list, "Catalogue de prestations", "Vos tarifs plomberie / chauffage", () => go("catalogue")));
    grid.appendChild(carteNav(I.file, "Documents", "Attestations d'entretien et TVA 10 %", () => go("documents")));
    cont.appendChild(grid);

    // Rappel infos entreprise si manquantes
    if (!infos || !infos.raisonSociale) {
      const warn = el(`
        <button class="pl-info-warn">
          ${I.building}
          <div><b>Renseignez les infos de votre entreprise</b><span>Necessaires pour editer les attestations (raison sociale, SIRET, assurance...).</span></div>
        </button>`);
      warn.addEventListener("click", () => go("documents"));
      cont.appendChild(warn);
    }
    return cont;
  }

  function carteNav(icon, titre, sous, onClick) {
    const c = el(`
      <button class="pl-card">
        <span class="pl-card-ic">${icon}</span>
        <span class="pl-card-t">${esc(titre)}</span>
        <span class="pl-card-s">${esc(sous)}</span>
      </button>`);
    c.addEventListener("click", onClick);
    return c;
  }

  // ---------- Section CONTRATS ----------
  async function sectionContrats() {
    const contrats = (await store.contrats()).slice().sort((a, b) => {
      const ea = echeance(a).prochaine || "9999", eb = echeance(b).prochaine || "9999";
      return ea.localeCompare(eb);
    });
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Contrats d'entretien", "Chaudieres, chauffe-eau, PAC... avec rappels", true));

    if (!contrats.length) {
      cont.appendChild(el(`<div class="empty">Aucun contrat d'entretien.<br><span>Ajoutez vos clients sous contrat pour ne plus oublier une echeance.</span></div>`));
    } else {
      const list = el(`<div class="list"></div>`);
      contrats.forEach((c) => list.appendChild(carteContrat(c)));
      cont.appendChild(list);
    }
    const fab = el(`<button class="fab" title="Nouveau contrat">${I.plus}</button>`);
    fab.addEventListener("click", () => formContrat(null));
    cont.appendChild(fab);
    return cont;
  }

  function carteContrat(c) {
    const e = echeance(c);
    const badge = e.etat === "retard" ? `<span class="pl-badge retard">En retard</span>`
      : e.etat === "bientot" ? `<span class="pl-badge bientot">Bientot</span>`
        : e.etat === "ok" ? `<span class="pl-badge ok">A jour</span>`
          : `<span class="pl-badge inconnu">A planifier</span>`;
    const card = el(`
      <div class="card pl-contrat">
        <div class="card-body">
          <div class="card-top">
            <span class="pl-contrat-app">${I.flame}${esc(c.appareilType || "Appareil")}</span>
            ${badge}
          </div>
          <div class="card-client">${esc(c.client)}</div>
          ${c.adresse ? `<div class="card-adr">${esc(c.adresse)}</div>` : ""}
          <div class="pl-contrat-meta">
            <span>Dernier : <b>${fmtFR(c.dateDernier)}</b></span>
            <span>Prochain : <b>${fmtFR(e.prochaine)}</b></span>
            ${c.montant ? `<span>Tarif : <b>${euro(c.montant)}</b></span>` : ""}
          </div>
          <div class="pl-contrat-actions">
            <button class="act-btn" data-a="planifier">${I.calendar}Planifier</button>
            <button class="act-btn" data-a="fait">${I.check}Entretien fait</button>
            <button class="act-btn" data-a="attest">${I.file}Attestation</button>
            <button class="act-btn" data-a="edit">${I.edit}Modifier</button>
          </div>
        </div>
      </div>`);
    card.querySelector('[data-a="planifier"]').addEventListener("click", () => planifierEntretien(c));
    card.querySelector('[data-a="fait"]').addEventListener("click", () => marquerEntretenu(c));
    card.querySelector('[data-a="attest"]').addEventListener("click", () => docAttestationEntretien(c));
    card.querySelector('[data-a="edit"]').addEventListener("click", () => formContrat(c));
    return card;
  }

  async function planifierEntretien(c) {
    const e = echeance(c);
    const date = e.prochaine || todayISO();
    await S.api.createIntervention({
      client: c.client, adresse: c.adresse || "", tel: c.tel || "",
      date, heure: "08:00",
      description: "Entretien annuel : " + (c.appareilType || "appareil") + (c.appareilMarque ? " " + c.appareilMarque : "") + ".",
    });
    toast("Entretien planifie le " + fmtFR(date));
    if (S.allerPlanning) S.allerPlanning(date);
  }

  async function marquerEntretenu(c) {
    const quand = prompt("Date de l'entretien realise (AAAA-MM-JJ) :", todayISO());
    if (!quand) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(quand)) { toast("Date invalide (format AAAA-MM-JJ)."); return; }
    c.dateDernier = quand;
    await store.saveContrat(c);
    toast("Entretien enregistre. Prochaine echeance mise a jour.");
    repaint();
  }

  function formContrat(c) {
    const edition = !!c;
    const d = c || { client: "", adresse: "", tel: "", appareilType: "Chaudiere gaz", appareilMarque: "", appareilModele: "", dateDernier: todayISO(), frequenceMois: 12, montant: "", notes: "" };
    const opts = TYPES_APPAREIL.map((t) => `<option value="${esc(t)}" ${t === d.appareilType ? "selected" : ""}>${esc(t)}</option>`).join("");
    const sheet = el(`
      <div class="modal">
        <div class="sheet">
          <div class="sheet-head"><h2>${edition ? "Modifier le contrat" : "Nouveau contrat d'entretien"}</h2><button class="x" id="close">&times;</button></div>
          <div class="sheet-body">
            <label>Client<input id="c-client" type="text" value="${esc(d.client)}" placeholder="Nom du client"></label>
            <label>Adresse<input id="c-adresse" type="text" value="${esc(d.adresse)}" placeholder="Adresse de l'appareil"></label>
            <label>Telephone<input id="c-tel" type="tel" value="${esc(d.tel)}" placeholder="06 ..."></label>
            <label>Type d'appareil<select id="c-type">${opts}</select></label>
            <div class="row2">
              <label>Marque<input id="c-marque" type="text" value="${esc(d.appareilMarque)}" placeholder="Ex : Saunier Duval"></label>
              <label>Modele<input id="c-modele" type="text" value="${esc(d.appareilModele)}" placeholder="Ex : Themis"></label>
            </div>
            <div class="row2">
              <label>Dernier entretien<input id="c-dernier" type="date" value="${esc(d.dateDernier)}"></label>
              <label>Frequence (mois)<input id="c-freq" type="number" min="1" max="60" value="${esc(d.frequenceMois || 12)}"></label>
            </div>
            <label>Tarif de l'entretien (€ TTC)<input id="c-montant" type="number" min="0" step="1" value="${esc(d.montant)}" placeholder="Ex : 130"></label>
            <label>Notes<textarea id="c-notes" rows="2" placeholder="Ex : contrat annuel, appareil au sous-sol">${esc(d.notes)}</textarea></label>
          </div>
          <div class="sheet-foot">
            ${edition ? '<button class="danger" id="del">Supprimer</button>' : "<span></span>"}
            <button class="primary" id="save">${edition ? "Enregistrer" : "Ajouter"}</button>
          </div>
        </div>
      </div>`);
    const close = () => sheet.remove();
    sheet.querySelector("#close").addEventListener("click", close);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
    sheet.querySelector("#save").addEventListener("click", async () => {
      const nc = {
        id: edition ? c.id : undefined,
        client: sheet.querySelector("#c-client").value.trim(),
        adresse: sheet.querySelector("#c-adresse").value.trim(),
        tel: sheet.querySelector("#c-tel").value.trim(),
        appareilType: sheet.querySelector("#c-type").value,
        appareilMarque: sheet.querySelector("#c-marque").value.trim(),
        appareilModele: sheet.querySelector("#c-modele").value.trim(),
        dateDernier: sheet.querySelector("#c-dernier").value,
        frequenceMois: Math.max(1, parseInt(sheet.querySelector("#c-freq").value, 10) || 12),
        montant: sheet.querySelector("#c-montant").value.trim(),
        notes: sheet.querySelector("#c-notes").value.trim(),
      };
      if (!nc.client) { toast("Indiquez au moins le nom du client."); return; }
      await store.saveContrat(nc);
      close();
      repaint();
    });
    if (edition) {
      sheet.querySelector("#del").addEventListener("click", async () => {
        if (!confirm("Supprimer ce contrat d'entretien ?")) return;
        await store.deleteContrat(c.id);
        close();
        repaint();
      });
    }
    document.getElementById("app").appendChild(sheet);
  }

  // ---------- Section CATALOGUE ----------
  async function sectionCatalogue() {
    const list = await store.catalogue();
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Catalogue de prestations", "Vos tarifs plomberie / chauffage (HT)", true));
    const box = el(`<div class="list"></div>`);
    list.forEach((p) => {
      const row = el(`
        <div class="card pl-presta">
          <div class="card-body">
            <div class="pl-presta-top">
              <span class="pl-presta-lib">${esc(p.libelle)}</span>
              <span class="pl-presta-prix">${euro(p.prixHT)}<span class="pl-presta-u">/ ${esc(p.unite)}</span></span>
            </div>
            <div class="pl-presta-actions">
              <button class="mini" data-a="edit">Modifier</button>
              <button class="mini danger-txt" data-a="del">Supprimer</button>
            </div>
          </div>
        </div>`);
      row.querySelector('[data-a="edit"]').addEventListener("click", () => formPresta(p));
      row.querySelector('[data-a="del"]').addEventListener("click", async () => {
        if (!confirm("Supprimer cette prestation du catalogue ?")) return;
        await store.deletePresta(p.id);
        repaint();
      });
      box.appendChild(row);
    });
    cont.appendChild(box);
    const fab = el(`<button class="fab" title="Nouvelle prestation">${I.plus}</button>`);
    fab.addEventListener("click", () => formPresta(null));
    cont.appendChild(fab);
    return cont;
  }

  function formPresta(p) {
    const edition = !!p;
    const d = p || { libelle: "", unite: "forfait", prixHT: "" };
    const unites = ["forfait", "heure", "unite", "m", "ml", "m2", "jour"];
    const opts = unites.map((u) => `<option value="${u}" ${u === d.unite ? "selected" : ""}>${u}</option>`).join("");
    const sheet = el(`
      <div class="modal">
        <div class="sheet">
          <div class="sheet-head"><h2>${edition ? "Modifier la prestation" : "Nouvelle prestation"}</h2><button class="x" id="close">&times;</button></div>
          <div class="sheet-body">
            <label>Libelle<input id="p-lib" type="text" value="${esc(d.libelle)}" placeholder="Ex : Remplacement mitigeur"></label>
            <div class="row2">
              <label>Prix HT (€)<input id="p-prix" type="number" min="0" step="0.5" value="${esc(d.prixHT)}"></label>
              <label>Unite<select id="p-unite">${opts}</select></label>
            </div>
          </div>
          <div class="sheet-foot"><span></span><button class="primary" id="save">${edition ? "Enregistrer" : "Ajouter"}</button></div>
        </div>
      </div>`);
    const close = () => sheet.remove();
    sheet.querySelector("#close").addEventListener("click", close);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
    sheet.querySelector("#save").addEventListener("click", async () => {
      const np = {
        id: edition ? p.id : undefined,
        libelle: sheet.querySelector("#p-lib").value.trim(),
        unite: sheet.querySelector("#p-unite").value,
        prixHT: parseFloat(sheet.querySelector("#p-prix").value) || 0,
      };
      if (!np.libelle) { toast("Indiquez un libelle."); return; }
      await store.savePresta(np);
      close();
      repaint();
    });
    document.getElementById("app").appendChild(sheet);
  }

  // ---------- Section DOCUMENTS ----------
  async function sectionDocuments() {
    const infos = await store.infos();
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Documents", "Attestations pretes a imprimer", true));

    const grid = el(`<div class="pl-cards"></div>`);
    const cInfos = carteNav(I.building, "Infos de mon entreprise", infos && infos.raisonSociale ? esc(infos.raisonSociale) : "A renseigner", () => formInfos());
    if (!infos || !infos.raisonSociale) cInfos.classList.add("warn");
    grid.appendChild(cInfos);
    grid.appendChild(carteNav(I.file, "Attestation TVA 10 %", "Travaux de renovation (logement > 2 ans)", () => formAttestationTVA()));
    cont.appendChild(grid);

    cont.appendChild(el(`<p class="pl-note">L'attestation d'entretien de chaudiere se genere depuis chaque contrat, dans l'onglet <b>Contrats d'entretien</b> (bouton Attestation).</p>`));
    return cont;
  }

  function formInfos() {
    store.infos().then((infos) => {
      const d = infos || { raisonSociale: "", siret: "", adresse: "", tel: "", email: "", assureur: "", assurancePolice: "", tvaIntra: "" };
      const sheet = el(`
        <div class="modal">
          <div class="sheet">
            <div class="sheet-head"><h2>Infos de mon entreprise</h2><button class="x" id="close">&times;</button></div>
            <div class="sheet-body">
              <p class="reg-hint">Ces informations apparaissent en en-tete de vos attestations. Elles restent sur votre appareil.</p>
              <label>Raison sociale<input id="i-rs" type="text" value="${esc(d.raisonSociale)}" placeholder="Ex : Plomberie Martin"></label>
              <label>SIRET<input id="i-siret" type="text" value="${esc(d.siret)}" placeholder="14 chiffres"></label>
              <label>Adresse<input id="i-adr" type="text" value="${esc(d.adresse)}" placeholder="Adresse de l'entreprise"></label>
              <div class="row2">
                <label>Telephone<input id="i-tel" type="tel" value="${esc(d.tel)}"></label>
                <label>Email<input id="i-email" type="email" value="${esc(d.email)}"></label>
              </div>
              <div class="row2">
                <label>Assureur (decennale)<input id="i-ass" type="text" value="${esc(d.assureur)}" placeholder="Ex : MAAF"></label>
                <label>N° de police<input id="i-pol" type="text" value="${esc(d.assurancePolice)}"></label>
              </div>
              <label>N° TVA intracommunautaire <span class="opt">(optionnel)</span><input id="i-tva" type="text" value="${esc(d.tvaIntra)}" placeholder="FR..."></label>
            </div>
            <div class="sheet-foot"><span></span><button class="primary" id="save">Enregistrer</button></div>
          </div>
        </div>`);
      const close = () => sheet.remove();
      sheet.querySelector("#close").addEventListener("click", close);
      sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
      sheet.querySelector("#save").addEventListener("click", async () => {
        const nd = {
          raisonSociale: sheet.querySelector("#i-rs").value.trim(),
          siret: sheet.querySelector("#i-siret").value.trim(),
          adresse: sheet.querySelector("#i-adr").value.trim(),
          tel: sheet.querySelector("#i-tel").value.trim(),
          email: sheet.querySelector("#i-email").value.trim(),
          assureur: sheet.querySelector("#i-ass").value.trim(),
          assurancePolice: sheet.querySelector("#i-pol").value.trim(),
          tvaIntra: sheet.querySelector("#i-tva").value.trim(),
        };
        if (!nd.raisonSociale) { toast("Indiquez au moins la raison sociale."); return; }
        await store.setInfos(nd);
        close();
        repaint();
        toast("Infos entreprise enregistrees.");
      });
      document.getElementById("app").appendChild(sheet);
    });
  }


  // Formulaire de saisie de l'attestation d'entretien : valeurs techniques + signatures.
  async function docAttestationEntretien(c) {
    const infos = await store.infos();
    if (!infos || !infos.raisonSociale) { toast("Renseignez d'abord les infos de votre entreprise (onglet Documents)."); go("documents"); return; }
    const dateEntretien = c.dateDernier || todayISO();
    const sigEnregistree = !!infos.signatureTech;
    const sheet = el(`
      <div class="modal">
        <div class="sheet">
          <div class="sheet-head"><h2>Attestation d'entretien</h2><button class="x" id="close">&times;</button></div>
          <div class="sheet-body">
            <div class="det-sub">${esc(c.client)} &middot; ${esc(c.appareilType || "appareil")}</div>
            <div class="row2">
              <label>Date de l'entretien<input id="a-date" type="date" value="${esc(dateEntretien)}"></label>
              <label>Fait a (ville)<input id="a-ville" type="text" placeholder="Ex : Le Creusot"></label>
            </div>
            <div class="row2">
              <label>Teneur en CO (ppm)<input id="a-co" type="number" min="0" step="1" placeholder="Ex : 12"></label>
              <label>Taux de CO2 (%)<input id="a-co2" type="number" min="0" step="0.1" placeholder="Ex : 7.5"></label>
            </div>
            <div class="row2">
              <label>Temperature fumees (°C)<input id="a-tf" type="number" min="0" step="1" placeholder="Ex : 120"></label>
              <label>Rendement (%)<input id="a-rdt" type="number" min="0" step="1" placeholder="Ex : 92"></label>
            </div>
            <label>Resultat de l'entretien<select id="a-res">
              <option value="Appareil en bon etat de fonctionnement">Appareil en bon etat de fonctionnement</option>
              <option value="Fonctionnement correct, point a surveiller">Fonctionnement correct, point a surveiller</option>
              <option value="Anomalie signalee au client">Anomalie signalee au client</option>
            </select></label>
            <label>Observations<textarea id="a-obs" rows="2" placeholder="Ex : appareil propre, aucune fuite constatee"></textarea></label>
            <label>Conseils au client<textarea id="a-cons" rows="2" placeholder="Ex : prevoir le detartrage l'an prochain"></textarea></label>

            <div class="sig-bloc">
              <div class="sig-lab">Signature du technicien ${sigEnregistree ? '<span class="sig-hint">(une signature est enregistree : laissez vide pour la reutiliser)</span>' : ""}</div>
              <canvas class="sig-pad" id="sig-tech"></canvas>
              <div class="sig-actions">
                <button type="button" class="mini" id="sig-tech-clear">Effacer</button>
                <label class="sig-save"><input type="checkbox" id="sig-tech-save"> Enregistrer ma signature</label>
              </div>
            </div>
            <div class="sig-bloc">
              <div class="sig-lab">Signature du client</div>
              <canvas class="sig-pad" id="sig-client"></canvas>
              <div class="sig-actions"><button type="button" class="mini" id="sig-client-clear">Effacer</button></div>
            </div>
          </div>
          <div class="sheet-foot"><span></span><button class="primary" id="gen">Generer l'attestation</button></div>
        </div>
      </div>`);
    const close = () => sheet.remove();
    sheet.querySelector("#close").addEventListener("click", close);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
    document.getElementById("app").appendChild(sheet);

    // Pavés de signature (init apres insertion dans le DOM pour avoir les dimensions)
    const padTech = creerSignaturePad(sheet.querySelector("#sig-tech"));
    const padClient = creerSignaturePad(sheet.querySelector("#sig-client"));
    sheet.querySelector("#sig-tech-clear").addEventListener("click", () => padTech.effacer());
    sheet.querySelector("#sig-client-clear").addEventListener("click", () => padClient.effacer());

    sheet.querySelector("#gen").addEventListener("click", async () => {
      const val = (id) => sheet.querySelector(id).value.trim();
      let sigTech = padTech.dataURL();
      if (!sigTech && infos.signatureTech) sigTech = infos.signatureTech; // reutilise la signature enregistree
      if (padTech.dataURL() && sheet.querySelector("#sig-tech-save").checked) {
        infos.signatureTech = padTech.dataURL();
        await store.setInfos(infos);
      }
      const data = {
        infos,
        client: c.client,
        adresse: c.adresse || "",
        appareilType: c.appareilType || "",
        appareilMM: [c.appareilMarque, c.appareilModele].filter(Boolean).join(" "),
        dateEntretienFR: fmtFR(val("#a-date") || dateEntretien),
        dateJourFR: fmtFR(todayISO()),
        ville: val("#a-ville"),
        co: val("#a-co"), co2: val("#a-co2"), tfumees: val("#a-tf"), rendement: val("#a-rdt"),
        resultat: sheet.querySelector("#a-res").value,
        observations: val("#a-obs"), conseils: val("#a-cons"),
        sigTechSrc: sigTech, sigClientSrc: padClient.dataURL(),
      };
      close();
      const canvas = await construireCanvasAttestation(data);
      const nomFichier = "Attestation_entretien_" + (c.client || "client").replace(/[^a-zA-Z0-9]+/g, "_") + ".png";
      apercuImage(canvas, nomFichier);
    });
  }

  // ---------- Signature tactile ----------
  function creerSignaturePad(canvas) {
    const ctx = canvas.getContext("2d");
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0f1720";
    let dessine = false, vide = true, last = null;
    const pos = (e) => {
      const b = canvas.getBoundingClientRect();
      const t = e.touches && e.touches[0] ? e.touches[0] : e;
      return { x: t.clientX - b.left, y: t.clientY - b.top };
    };
    const down = (e) => { dessine = true; last = pos(e); e.preventDefault(); };
    const move = (e) => {
      if (!dessine) return;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p; vide = false; e.preventDefault();
    };
    const up = () => { dessine = false; };
    canvas.addEventListener("mousedown", down); canvas.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    canvas.addEventListener("touchstart", down, { passive: false }); canvas.addEventListener("touchmove", move, { passive: false }); canvas.addEventListener("touchend", up);
    return {
      estVide: () => vide,
      effacer: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); vide = true; },
      dataURL: () => vide ? null : canvas.toDataURL("image/png"),
    };
  }

  // ---------- Rendu de l'attestation en image (canvas) ----------
  function chargerImg(src) {
    return new Promise((res) => {
      if (!src) { res(null); return; }
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
  }

  async function construireCanvasAttestation(data) {
    const imgTech = await chargerImg(data.sigTechSrc);
    const imgClient = await chargerImg(data.sigClientSrc);
    const W = 1240, M = 90, cW = W - M * 2;

    function wrap(ctx, texte, maxW) {
      const mots = String(texte).split(/\s+/);
      const lignes = []; let cur = "";
      mots.forEach((mot) => {
        const test = cur ? cur + " " + mot : mot;
        if (ctx.measureText(test).width > maxW && cur) { lignes.push(cur); cur = mot; }
        else cur = test;
      });
      if (cur) lignes.push(cur);
      return lignes;
    }

    function render(ctx, draw) {
      let y = 78;
      ctx.textBaseline = "top"; ctx.textAlign = "left";
      // En-tete entreprise
      ctx.fillStyle = "#0f1720"; ctx.font = "700 40px Arial";
      if (draw) ctx.fillText(data.infos.raisonSociale, M, y);
      y += 54;
      ctx.font = "21px Arial"; ctx.fillStyle = "#55617a";
      [
        data.infos.adresse,
        data.infos.siret ? "SIRET " + data.infos.siret : "",
        [data.infos.tel, data.infos.email].filter(Boolean).join("   .   "),
        data.infos.tvaIntra ? "TVA " + data.infos.tvaIntra : "",
        data.infos.assureur ? "Assurance decennale : " + data.infos.assureur + (data.infos.assurancePolice ? " (" + data.infos.assurancePolice + ")" : "") : "",
      ].filter(Boolean).forEach((l) => { if (draw) ctx.fillText(l, M, y); y += 29; });
      y += 8;
      if (draw) { ctx.strokeStyle = "#0f1720"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke(); }
      y += 34;
      // Titre
      ctx.textAlign = "center"; ctx.fillStyle = "#0f1720"; ctx.font = "700 36px Arial";
      if (draw) ctx.fillText("ATTESTATION D'ENTRETIEN", W / 2, y); y += 46;
      ctx.font = "21px Arial"; ctx.fillStyle = "#55617a";
      if (draw) ctx.fillText("Chaudiere / appareil de chauffage", W / 2, y); y += 40;
      ctx.textAlign = "left";
      // Intro
      ctx.fillStyle = "#1a2230"; ctx.font = "22px Arial";
      wrap(ctx, "Je soussigne, representant la societe " + data.infos.raisonSociale + ", atteste avoir realise l'entretien de l'appareil ci-dessous, conformement a la reglementation en vigueur relative a l'entretien annuel des appareils de chauffage.", cW)
        .forEach((l) => { if (draw) ctx.fillText(l, M, y); y += 30; });
      y += 16;
      // Tableaux (label / valeur)
      const tableau = (rows) => {
        rows.forEach(([lab, v]) => {
          const labW = cW * 0.4;
          const vLignes = wrap(ctx, v || "-", cW - labW - 24);
          const rowH = Math.max(42, 14 + vLignes.length * 26);
          if (draw) {
            ctx.strokeStyle = "#dde3ee"; ctx.lineWidth = 1;
            ctx.strokeRect(M, y, cW, rowH);
            ctx.fillStyle = "#f6f8fc"; ctx.fillRect(M, y, labW, rowH);
            ctx.strokeRect(M, y, labW, rowH);
            ctx.fillStyle = "#55617a"; ctx.font = "600 20px Arial";
            ctx.fillText(lab, M + 12, y + 11);
            ctx.fillStyle = "#1a2230"; ctx.font = "21px Arial";
            vLignes.forEach((l, i) => ctx.fillText(l, M + labW + 12, y + 11 + i * 26));
          }
          y += rowH;
        });
      };
      const sectionTitre = (t) => {
        y += 12;
        ctx.fillStyle = "#0f1720"; ctx.font = "700 23px Arial";
        if (draw) { ctx.fillText(t, M, y); ctx.strokeStyle = "#dde3ee"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, y + 30); ctx.lineTo(W - M, y + 30); ctx.stroke(); }
        y += 42;
      };
      tableau([
        ["Client", data.client],
        ["Adresse de l'appareil", data.adresse || "-"],
        ["Type d'appareil", data.appareilType || "-"],
        ["Marque / modele", data.appareilMM || "-"],
        ["Date de l'entretien", data.dateEntretienFR],
      ]);
      sectionTitre("Mesures et controles");
      tableau([
        ["Teneur en CO", data.co ? data.co + " ppm" : "-"],
        ["Taux de CO2", data.co2 ? data.co2 + " %" : "-"],
        ["Temperature des fumees", data.tfumees ? data.tfumees + " °C" : "-"],
        ["Rendement", data.rendement ? data.rendement + " %" : "-"],
        ["Resultat", data.resultat || "-"],
      ]);
      sectionTitre("Operations realisees");
      ctx.fillStyle = "#1a2230"; ctx.font = "21px Arial";
      ["Verification et nettoyage des organes de l'appareil",
        "Controle de l'etancheite et des raccordements",
        "Controle des dispositifs de securite",
        "Mesure des rejets de combustion et controle du fonctionnement"].forEach((op) => {
          if (draw) { ctx.fillText("•", M + 4, y); ctx.fillText(op, M + 28, y); }
          y += 30;
        });
      if (data.observations) {
        sectionTitre("Observations");
        ctx.fillStyle = "#1a2230"; ctx.font = "21px Arial";
        wrap(ctx, data.observations, cW).forEach((l) => { if (draw) ctx.fillText(l, M, y); y += 29; });
      }
      if (data.conseils) {
        sectionTitre("Conseils au client");
        ctx.fillStyle = "#1a2230"; ctx.font = "21px Arial";
        wrap(ctx, data.conseils, cW).forEach((l) => { if (draw) ctx.fillText(l, M, y); y += 29; });
      }
      // Fait a ... le ...
      y += 22;
      ctx.fillStyle = "#1a2230"; ctx.font = "22px Arial";
      if (draw) ctx.fillText("Fait a " + (data.ville || "...................") + ", le " + data.dateJourFR, M, y);
      y += 44;
      // Signatures
      const boxW = (cW - 40) / 2, boxH = 190;
      const dessineSig = (x, label, img) => {
        if (!draw) return;
        ctx.strokeStyle = "#c7cfe0"; ctx.lineWidth = 1; ctx.strokeRect(x, y, boxW, boxH);
        ctx.fillStyle = "#55617a"; ctx.font = "600 18px Arial";
        ctx.fillText(label, x + 12, y + 10);
        if (img) {
          const pad = 16, availW = boxW - pad * 2, availH = boxH - 48;
          const scale = Math.min(availW / img.width, availH / img.height, 1);
          const w = img.width * scale, h = img.height * scale;
          ctx.drawImage(img, x + (boxW - w) / 2, y + 40 + (availH - h) / 2, w, h);
        }
      };
      dessineSig(M, "Signature du technicien", imgTech);
      dessineSig(M + boxW + 40, "Signature du client", imgClient);
      y += boxH + 26;
      // Pied
      if (draw) {
        ctx.strokeStyle = "#dde3ee"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
        ctx.fillStyle = "#8892a6"; ctx.font = "17px Arial"; ctx.textAlign = "center";
        ctx.fillText("Attestation remise au client. Document a conserver.", W / 2, y + 12);
        ctx.textAlign = "left";
      }
      y += 44;
      return y;
    }

    // 1re passe (mesure) puis 2e passe (dessin) sur un canvas a la bonne hauteur
    const tmp = document.createElement("canvas"); tmp.width = W; tmp.height = 3200;
    const finalY = render(tmp.getContext("2d"), false);
    const H = Math.max(1754, Math.ceil(finalY));
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
    render(ctx, true);
    return cv;
  }

  // ---------- Apercu image : imprimer ou envoyer (partage) ----------
  function apercuImage(canvas, nomFichier) {
    const dataUrl = canvas.toDataURL("image/png");
    const back = el(`
      <div class="doc-overlay">
        <div class="doc-actions">
          <button class="ghost2" id="doc-close">&lsaquo; Fermer</button>
          <span class="doc-actions-r">
            <button class="ghost2" id="doc-print">Imprimer</button>
            <button class="primary" id="doc-send">Envoyer</button>
          </span>
        </div>
        <div class="doc-sheet doc-img"><img alt="Attestation d'entretien" src="${dataUrl}"></div>
      </div>`);
    document.body.appendChild(back);
    document.body.style.overflow = "hidden";
    const close = () => { back.remove(); document.body.style.overflow = ""; };
    back.querySelector("#doc-close").addEventListener("click", close);
    back.querySelector("#doc-print").addEventListener("click", () => {
      toast("Choisissez « Enregistrer en PDF » dans le menu d'impression.");
      setTimeout(() => window.print(), 250);
    });
    back.querySelector("#doc-send").addEventListener("click", () => {
      canvas.toBlob((blob) => { if (blob) partager(blob, nomFichier); }, "image/png");
    });
  }

  async function partager(blob, nomFichier) {
    const file = new File([blob], nomFichier, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Attestation d'entretien" }); }
      catch (e) { /* partage annule par l'utilisateur */ }
    } else {
      // Repli (ordinateur, navigateur sans partage de fichier) : telechargement
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = nomFichier; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast("Partage direct indisponible ici : le fichier a ete telecharge.");
    }
  }

  function formAttestationTVA() {
    store.infos().then((infos) => {
      if (!infos || !infos.raisonSociale) { toast("Renseignez d'abord les infos de votre entreprise."); formInfos(); return; }
      const sigEnregistree = !!infos.signatureTech;
      const sheet = el(`
        <div class="modal">
          <div class="sheet">
            <div class="sheet-head"><h2>Attestation TVA a taux reduit</h2><button class="x" id="close">&times;</button></div>
            <div class="sheet-body">
              <p class="reg-hint">Pour les travaux dans un logement acheve depuis plus de 2 ans. Le client remplit et signe cette attestation.</p>
              <label>Nom du client<input id="t-client" type="text" placeholder="Nom et prenom"></label>
              <label>Adresse des travaux<input id="t-adresse" type="text" placeholder="Adresse du logement"></label>
              <label>Nature des travaux<textarea id="t-nature" rows="3" placeholder="Ex : remplacement d'une chaudiere, renovation salle de bain..."></textarea></label>
              <label>Taux applique<select id="t-taux">
                <option value="10">10 % (amelioration, entretien, transformation)</option>
                <option value="5.5">5,5 % (renovation energetique)</option>
              </select></label>
              <div class="row2">
                <label>Fait a (ville)<input id="t-ville" type="text" placeholder="Ex : Le Creusot"></label>
                <label>Date<input id="t-date" type="date" value="${esc(todayISO())}"></label>
              </div>
              <div class="sig-bloc">
                <div class="sig-lab">Signature du client</div>
                <canvas class="sig-pad" id="sig-tva-client"></canvas>
                <div class="sig-actions"><button type="button" class="mini" id="sig-tva-client-clear">Effacer</button></div>
              </div>
              <div class="sig-bloc">
                <div class="sig-lab">Signature de l'entreprise ${sigEnregistree ? '<span class="sig-hint">(signature enregistree : laissez vide pour la reutiliser)</span>' : ""}</div>
                <canvas class="sig-pad" id="sig-tva-ent"></canvas>
                <div class="sig-actions">
                  <button type="button" class="mini" id="sig-tva-ent-clear">Effacer</button>
                  <label class="sig-save"><input type="checkbox" id="sig-tva-ent-save"> Enregistrer ma signature</label>
                </div>
              </div>
            </div>
            <div class="sheet-foot"><span></span><button class="primary" id="gen">Generer l'attestation</button></div>
          </div>
        </div>`);
      const close = () => sheet.remove();
      sheet.querySelector("#close").addEventListener("click", close);
      sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
      document.getElementById("app").appendChild(sheet);

      const padClient = creerSignaturePad(sheet.querySelector("#sig-tva-client"));
      const padEnt = creerSignaturePad(sheet.querySelector("#sig-tva-ent"));
      sheet.querySelector("#sig-tva-client-clear").addEventListener("click", () => padClient.effacer());
      sheet.querySelector("#sig-tva-ent-clear").addEventListener("click", () => padEnt.effacer());

      sheet.querySelector("#gen").addEventListener("click", async () => {
        const client = sheet.querySelector("#t-client").value.trim();
        const adresse = sheet.querySelector("#t-adresse").value.trim();
        const nature = sheet.querySelector("#t-nature").value.trim();
        const taux = sheet.querySelector("#t-taux").value;
        if (!client || !adresse) { toast("Renseignez le client et l'adresse des travaux."); return; }
        let sigEnt = padEnt.dataURL();
        if (!sigEnt && infos.signatureTech) sigEnt = infos.signatureTech;
        if (padEnt.dataURL() && sheet.querySelector("#sig-tva-ent-save").checked) {
          infos.signatureTech = padEnt.dataURL();
          await store.setInfos(infos);
        }
        close();
        const data = {
          infos, client, adresse, nature, taux,
          ville: sheet.querySelector("#t-ville").value.trim(),
          dateFR: fmtFR(sheet.querySelector("#t-date").value || todayISO()),
          sigClientSrc: padClient.dataURL(), sigEntSrc: sigEnt,
        };
        const canvas = await construireCanvasTVA(data);
        const nomFichier = "Attestation_TVA_" + (client || "client").replace(/[^a-zA-Z0-9]+/g, "_") + ".png";
        apercuImage(canvas, nomFichier);
      });
    });
  }

  async function construireCanvasTVA(data) {
    const imgClient = await chargerImg(data.sigClientSrc);
    const imgEnt = await chargerImg(data.sigEntSrc);
    const tauxTxt = data.taux === "5.5" ? "5,5 %" : "10 %";
    const W = 1240, M = 90, cW = W - M * 2;

    function wrap(ctx, texte, maxW) {
      const mots = String(texte).split(/\s+/);
      const lignes = []; let cur = "";
      mots.forEach((mot) => {
        const test = cur ? cur + " " + mot : mot;
        if (ctx.measureText(test).width > maxW && cur) { lignes.push(cur); cur = mot; }
        else cur = test;
      });
      if (cur) lignes.push(cur);
      return lignes;
    }

    function render(ctx, draw) {
      let y = 78;
      ctx.textBaseline = "top"; ctx.textAlign = "left";
      // En-tete entreprise
      ctx.fillStyle = "#0f1720"; ctx.font = "700 40px Arial";
      if (draw) ctx.fillText(data.infos.raisonSociale, M, y);
      y += 54;
      ctx.font = "21px Arial"; ctx.fillStyle = "#46506a";
      [
        data.infos.adresse,
        data.infos.siret ? "SIRET " + data.infos.siret : "",
        [data.infos.tel, data.infos.email].filter(Boolean).join("   .   "),
        data.infos.tvaIntra ? "TVA " + data.infos.tvaIntra : "",
      ].filter(Boolean).forEach((l) => { if (draw) ctx.fillText(l, M, y); y += 29; });
      y += 8;
      if (draw) { ctx.strokeStyle = "#0f1720"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke(); }
      y += 34;
      // Titre + sous-titre centres
      ctx.textAlign = "center"; ctx.fillStyle = "#0f1720"; ctx.font = "700 36px Arial";
      if (draw) ctx.fillText("ATTESTATION SIMPLIFIEE", W / 2, y); y += 46;
      ctx.font = "20px Arial"; ctx.fillStyle = "#55617a";
      wrap(ctx, "Taux de TVA reduit de " + tauxTxt + " sur les travaux (articles 279-0 bis et 278-0 bis A du CGI)", cW)
        .forEach((l) => { if (draw) ctx.fillText(l, W / 2, y); y += 28; });
      y += 14; ctx.textAlign = "left";
      // Intro
      ctx.fillStyle = "#1a2230"; ctx.font = "22px Arial";
      wrap(ctx, "Je soussigne(e) " + data.client + ", client, atteste que les travaux realises par l'entreprise " + data.infos.raisonSociale + " a l'adresse ci-dessous portent sur un local repondant aux conditions suivantes :", cW)
        .forEach((l) => { if (draw) ctx.fillText(l, M, y); y += 30; });
      y += 16;
      // Tableau
      const tableau = (rows) => {
        rows.forEach(([lab, v]) => {
          const labW = cW * 0.4;
          const vLignes = wrap(ctx, v || "-", cW - labW - 24);
          const rowH = Math.max(42, 14 + vLignes.length * 26);
          if (draw) {
            ctx.strokeStyle = "#dde3ee"; ctx.lineWidth = 1; ctx.strokeRect(M, y, cW, rowH);
            ctx.fillStyle = "#f6f8fc"; ctx.fillRect(M, y, labW, rowH); ctx.strokeRect(M, y, labW, rowH);
            ctx.fillStyle = "#46506a"; ctx.font = "600 20px Arial"; ctx.fillText(lab, M + 12, y + 11);
            ctx.fillStyle = "#1a2230"; ctx.font = "21px Arial";
            vLignes.forEach((l, i) => ctx.fillText(l, M + labW + 12, y + 11 + i * 26));
          }
          y += rowH;
        });
      };
      tableau([
        ["Adresse des travaux", data.adresse],
        ["Nature des travaux", data.nature || "-"],
        ["Taux de TVA applique", tauxTxt],
      ]);
      // Section attestation client
      y += 16;
      ctx.fillStyle = "#0f1720"; ctx.font = "700 23px Arial";
      if (draw) { ctx.fillText("Le client atteste que :", M, y); ctx.strokeStyle = "#dde3ee"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, y + 30); ctx.lineTo(W - M, y + 30); ctx.stroke(); }
      y += 44;
      ctx.fillStyle = "#1a2230"; ctx.font = "21px Arial";
      ["le local est acheve depuis plus de deux ans a la date de debut des travaux ;",
        "il est affecte a l'habitation (residence principale ou secondaire) ;",
        "les travaux ne concourent pas a la production d'un immeuble neuf ni n'augmentent la surface de plancher de plus de 10 %."].forEach((it) => {
          const lignes = wrap(ctx, it, cW - 40);
          if (draw) { ctx.strokeStyle = "#1a2230"; ctx.lineWidth = 1.6; ctx.strokeRect(M, y + 1, 20, 20); }
          lignes.forEach((l, i) => { if (draw) ctx.fillText(l, M + 36, y + i * 27); });
          y += Math.max(30, lignes.length * 27) + 8;
        });
      // Mention responsabilite
      y += 6; ctx.fillStyle = "#46506a"; ctx.font = "20px Arial";
      wrap(ctx, "Le client conserve une copie de cette attestation et la remet a l'entreprise, qui la joint a sa facture. Cette attestation engage la responsabilite du client sur l'exactitude des informations declarees.", cW)
        .forEach((l) => { if (draw) ctx.fillText(l, M, y); y += 28; });
      // Fait a
      y += 20; ctx.fillStyle = "#1a2230"; ctx.font = "22px Arial";
      if (draw) ctx.fillText("Fait a " + (data.ville || "...................") + ", le " + data.dateFR, M, y);
      y += 44;
      // Signatures
      const boxW = (cW - 40) / 2, boxH = 190;
      const dessineSig = (x, label, img) => {
        if (!draw) return;
        ctx.strokeStyle = "#c7cfe0"; ctx.lineWidth = 1; ctx.strokeRect(x, y, boxW, boxH);
        ctx.fillStyle = "#55617a"; ctx.font = "600 18px Arial"; ctx.fillText(label, x + 12, y + 10);
        if (img) {
          const pad = 16, availW = boxW - pad * 2, availH = boxH - 48;
          const scale = Math.min(availW / img.width, availH / img.height, 1);
          const w = img.width * scale, h = img.height * scale;
          ctx.drawImage(img, x + (boxW - w) / 2, y + 40 + (availH - h) / 2, w, h);
        }
      };
      dessineSig(M, "Signature du client", imgClient);
      dessineSig(M + boxW + 40, "Cachet et signature de l'entreprise", imgEnt);
      y += boxH + 26;
      if (draw) {
        ctx.strokeStyle = "#dde3ee"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
        ctx.fillStyle = "#8892a6"; ctx.font = "17px Arial"; ctx.textAlign = "center";
        ctx.fillText("Modele d'attestation. Verifiez l'eligibilite et le taux applicable a votre situation.", W / 2, y + 12);
        ctx.textAlign = "left";
      }
      y += 44;
      return y;
    }

    const tmp = document.createElement("canvas"); tmp.width = W; tmp.height = 3200;
    const finalY = render(tmp.getContext("2d"), false);
    const H = Math.max(1754, Math.ceil(finalY));
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
    render(ctx, true);
    return cv;
  }

  // ---------- API publique du module ----------
  S.plombier = {
    page,
    reset() { pstate.section = "accueil"; },
  };
})();
