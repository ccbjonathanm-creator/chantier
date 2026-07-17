/*
 * electricien.js - Module payant "Pack Electricien" de ClicChantier.
 *
 * 2e module METIER (apres plombier.js). Il ne s'affiche que si l'entreprise a
 * le droit "electricien" (features.actif("electricien")). Il apporte les
 * 3 briques concretes d'un pack metier :
 *   1. Calculateurs de metre NF C 15-100 (la vedette) :
 *        - Bilan de puissance -> abonnement kVA + calibre disjoncteur de branchement
 *        - Dimensionnement d'un circuit : intensite, section de cable, protection,
 *          chute de tension avec verdict conforme / non conforme
 *        - Table de reference des circuits normalises (section / protection / points)
 *   2. Catalogue de prestations electricien pre-rempli et editable.
 *   3. Documents signes : attestation de conformite NF C 15-100 + attestation TVA.
 *
 * Autonome, comme plombier.js : helpers propres, stockage propre. Il PARTAGE
 * volontairement les infos d'entreprise (meme cle localStorage que plombier)
 * et la signature enregistree : c'est la meme entreprise.
 *
 * NOTE archi : a terme, les briques communes (signature, rendu canvas des
 * documents, attestation TVA) ont vocation a etre extraites dans un fichier
 * partage js/docs.js. Pour l'instant chaque module reste autonome (doctrine
 * posee sur plombier.js) afin de ne pas fragiliser le pack Plombier valide.
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
    return "e_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }
  function toast(msg) {
    const t = el(`<div class="pl-toast">${esc(msg)}</div>`);
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2600);
  }

  // ---------- Icones locales ----------
  const I = {
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>',
    calc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15h6M9 11h2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    panel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h4"/></svg>',
    building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/></svg>',
    plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5"/></svg>',
  };

  // ---------- Stockage (async, pret pour le cloud) ----------
  // Infos entreprise : MEME cle que plombier.js (meme entreprise, infos partagees).
  const K_INFOS = "chantier_docs_infos_v1";
  // Catalogue propre a l'electricien (cle distincte du plombier).
  const K_CATALOGUE = "chantier_catalogue_elec_v1";

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

  // Catalogue de prestations electricien pre-rempli (tarifs HT indicatifs).
  const CATALOGUE_DEFAUT = [
    { libelle: "Deplacement + diagnostic", unite: "forfait", prixHT: 45 },
    { libelle: "Main d'oeuvre electricien", unite: "heure", prixHT: 50 },
    { libelle: "Recherche de panne electrique", unite: "forfait", prixHT: 90 },
    { libelle: "Remplacement tableau electrique (mise aux normes)", unite: "forfait", prixHT: 850 },
    { libelle: "Ajout d'une ligne / circuit dedie", unite: "unite", prixHT: 130 },
    { libelle: "Pose d'une prise de courant", unite: "unite", prixHT: 45 },
    { libelle: "Pose point lumineux + interrupteur", unite: "unite", prixHT: 70 },
    { libelle: "Remplacement interrupteur differentiel 30 mA", unite: "unite", prixHT: 120 },
    { libelle: "Pose disjoncteur divisionnaire", unite: "unite", prixHT: 35 },
    { libelle: "Mise a la terre (piquet + liaison equipotentielle)", unite: "forfait", prixHT: 250 },
    { libelle: "Pose et raccordement VMC", unite: "forfait", prixHT: 320 },
    { libelle: "Pose radiateur electrique (raccordement)", unite: "unite", prixHT: 90 },
    { libelle: "Installation borne de recharge VE 7,4 kW (IRVE)", unite: "forfait", prixHT: 900 },
    { libelle: "Pose tableau de communication (grade 2)", unite: "forfait", prixHT: 350 },
    { libelle: "Mise en conformite + attestation", unite: "forfait", prixHT: 180 },
  ];

  // Entreprise fictive par defaut (mode demo). Partagee avec le pack Plombier :
  // si le plombier a deja rempli ses infos, elles sont reprises telles quelles.
  const INFOS_DEFAUT = {
    raisonSociale: "SARL Electricite Bourgogne",
    siret: "80234567800021",
    adresse: "24 rue de l'Industrie, 71200 Le Creusot",
    tel: "03 85 55 30 40",
    email: "contact@elec-bourgogne.fr",
    assureur: "MAAF Pro",
    assurancePolice: "DEC-2024-88210",
    tvaIntra: "FR50802345678",
  };

  // ---------- Etat interne du module ----------
  const estate = { section: "accueil" };
  function go(section) { estate.section = section; S.rerender(); }
  function repaint() { S.rerender(); }

  // =====================================================================
  //  PAGE : renvoie le noeud de la section courante
  // =====================================================================
  async function page() {
    if (estate.section === "calc") return sectionCalcMenu();
    if (estate.section === "calc_bilan") return sectionCalcBilan();
    if (estate.section === "calc_circuit") return sectionCalcCircuit();
    if (estate.section === "calc_table") return sectionCalcTable();
    if (estate.section === "catalogue") return await sectionCatalogue();
    if (estate.section === "documents") return await sectionDocuments();
    return await sectionAccueil();
  }

  function enteteSection(titre, sousTitre, retourVers) {
    const h = el(`
      <div class="pl-head">
        ${retourVers !== undefined ? `<button class="pl-back" id="pl-back">&lsaquo; Retour</button>` : ""}
        <div class="pl-head-txt"><h2>${esc(titre)}</h2><p>${esc(sousTitre)}</p></div>
      </div>
    `);
    if (retourVers !== undefined) h.querySelector("#pl-back").addEventListener("click", () => go(retourVers));
    return h;
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

  // ---------- Section ACCUEIL ----------
  async function sectionAccueil() {
    const infos = await store.infos();
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Pack Electricien", "Vos outils metier", undefined));

    const grid = el(`<div class="pl-cards"></div>`);
    grid.appendChild(carteNav(I.calc, "Calculateurs NF C 15-100", "Puissance, section de cable, chute de tension", () => go("calc")));
    grid.appendChild(carteNav(I.list, "Catalogue de prestations", "Vos tarifs electricite", () => go("catalogue")));
    grid.appendChild(carteNav(I.file, "Documents", "Attestation de conformite et TVA", () => go("documents")));
    cont.appendChild(grid);

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

  // =====================================================================
  //  CALCULATEURS NF C 15-100
  // =====================================================================
  function sectionCalcMenu() {
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Calculateurs", "Aide au dimensionnement NF C 15-100", "accueil"));
    const grid = el(`<div class="pl-cards"></div>`);
    grid.appendChild(carteNav(I.bolt, "Bilan de puissance", "Abonnement kVA + disjoncteur de branchement", () => go("calc_bilan")));
    grid.appendChild(carteNav(I.plug, "Dimensionner un circuit", "Intensite, section, protection, chute de tension", () => go("calc_circuit")));
    grid.appendChild(carteNav(I.panel, "Table des circuits", "Sections et protections normalisees par usage", () => go("calc_table")));
    cont.appendChild(grid);
    cont.appendChild(el(`<p class="pl-note">Ces outils sont une <b>aide au dimensionnement</b>. Le resultat reste a verifier selon le mode de pose, la temperature et la reglementation en vigueur.</p>`));
    return cont;
  }

  // ----- Bilan de puissance -----
  // Postes du logement (puissance unitaire en W). Le coefficient de foisonnement
  // (simultaneite) est applique globalement : rares sont les appareils allumes
  // tous en meme temps. Valeurs usuelles ENEDIS / NF C 15-100.
  const POSTES_BILAN = [
    { cle: "base", label: "Eclairage + prises (base logement)", w: 2300, fixe: true },
    { cle: "plaque", label: "Plaque de cuisson / cuisiniere", w: 6000 },
    { cle: "four", label: "Four electrique", w: 2000 },
    { cle: "ll", label: "Lave-linge", w: 2300 },
    { cle: "lv", label: "Lave-vaisselle", w: 1800 },
    { cle: "sl", label: "Seche-linge", w: 2500 },
    { cle: "ecs", label: "Chauffe-eau (ballon ECS)", w: 2400 },
  ];
  // Standards d'abonnement monophase 230 V et calibres AGCP (disjoncteur de branchement).
  const ABONNEMENTS_MONO = [
    { kva: 3, a: 15 }, { kva: 6, a: 30 }, { kva: 9, a: 45 },
    { kva: 12, a: 60 }, { kva: 15, a: 75 }, { kva: 18, a: 90 },
  ];

  function sectionCalcBilan() {
    // Etat local persistant le temps de la session de la page
    const st = sectionCalcBilan._st || (sectionCalcBilan._st = {
      coches: { base: true }, chauffageW: "", autreW: "", foison: 0.7,
    });
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Bilan de puissance", "Puissance a souscrire et calibre du disjoncteur", "calc"));

    const form = el(`<div class="ec-form"></div>`);
    // Cases a cocher des postes standard
    const box = el(`<div class="ec-checks"></div>`);
    POSTES_BILAN.forEach((p) => {
      const on = !!st.coches[p.cle];
      const row = el(`
        <label class="ec-check ${p.fixe ? "fixe" : ""}">
          <input type="checkbox" ${on ? "checked" : ""} ${p.fixe ? "disabled" : ""} data-c="${p.cle}">
          <span class="ec-check-l">${esc(p.label)}</span>
          <span class="ec-check-w">${p.w} W</span>
        </label>`);
      if (!p.fixe) {
        row.querySelector("input").addEventListener("change", (e) => {
          st.coches[p.cle] = e.target.checked; recalc();
        });
      }
      box.appendChild(row);
    });
    form.appendChild(box);
    // Champs libres chauffage / autres
    form.appendChild(el(`<div class="row2">
      <label>Chauffage electrique (W total)<input id="b-chauf" type="number" min="0" step="100" value="${esc(st.chauffageW)}" placeholder="Ex : 6000"></label>
      <label>Autres postes (W)<input id="b-autre" type="number" min="0" step="100" value="${esc(st.autreW)}" placeholder="Clim, VE, piscine..."></label>
    </div>`));
    form.appendChild(el(`<label>Coefficient de foisonnement (simultaneite)
      <select id="b-foison">
        <option value="0.5">0,5 - grand logement, usage etale</option>
        <option value="0.6">0,6</option>
        <option value="0.7">0,7 - courant (recommande)</option>
        <option value="0.8">0,8</option>
        <option value="1">1 - tout simultane (securite max)</option>
      </select></label>`));
    cont.appendChild(form);

    const res = el(`<div class="ec-res" id="b-res"></div>`);
    cont.appendChild(res);

    const chauf = form.querySelector("#b-chauf");
    const autre = form.querySelector("#b-autre");
    const foison = form.querySelector("#b-foison");
    foison.value = String(st.foison);
    chauf.addEventListener("input", recalc);
    autre.addEventListener("input", recalc);
    foison.addEventListener("change", recalc);

    function recalc() {
      st.chauffageW = chauf.value; st.autreW = autre.value; st.foison = parseFloat(foison.value) || 0.7;
      let installee = 0;
      POSTES_BILAN.forEach((p) => { if (st.coches[p.cle] || p.fixe) installee += p.w; });
      installee += (parseFloat(chauf.value) || 0) + (parseFloat(autre.value) || 0);
      const foisonnee = installee * st.foison;
      const kva = foisonnee / 1000;
      // Abonnement conseille = premier palier >= puissance foisonnee
      let ab = ABONNEMENTS_MONO.find((a) => a.kva >= kva - 0.001);
      const triphase = !ab;
      if (!ab) ab = { kva: Math.ceil(kva / 3) * 3, a: null };
      res.innerHTML = `
        <div class="ec-res-t">Resultat</div>
        <div class="ec-res-row"><span>Puissance installee</span><b>${(installee / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} kW</b></div>
        <div class="ec-res-row"><span>Puissance foisonnee (x ${st.foison})</span><b>${kva.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} kVA</b></div>
        <div class="ec-res-main">
          <span>Abonnement conseille</span>
          <strong>${ab.kva} kVA${triphase ? " (triphase)" : " mono"}</strong>
        </div>
        ${ab.a ? `<div class="ec-res-row"><span>Disjoncteur de branchement</span><b>${ab.a} A</b></div>` : `<div class="ec-res-row"><span>Disjoncteur de branchement</span><b>a definir (triphase)</b></div>`}
        <p class="ec-res-note">Au-dela de 18 kVA en monophase, passage en <b>triphase 400 V</b> a etudier avec ENEDIS.</p>`;
    }
    recalc();
    return cont;
  }

  // ----- Dimensionner un circuit (intensite, section, protection, chute de tension) -----
  // Courant admissible domestique cuivre (NF C 15-100, correspondance usuelle
  // section -> calibre de protection maxi du circuit).
  const SECTIONS = [
    { s: 1.5, inMax: 16 },
    { s: 2.5, inMax: 20 },
    { s: 4, inMax: 25 },
    { s: 6, inMax: 32 },
    { s: 10, inMax: 40 },
    { s: 16, inMax: 63 },
    { s: 25, inMax: 80 },
    { s: 35, inMax: 100 },
  ];
  const CALIBRES = [2, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100];
  const RHO_CUIVRE = 0.0225; // ohm.mm2/m

  function sectionCalcCircuit() {
    const st = sectionCalcCircuit._st || (sectionCalcCircuit._st = {
      mode: "puissance", puissance: "", intensite: "", tension: "mono", cos: 1, longueur: "", usage: "autre",
    });
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Dimensionner un circuit", "Section de cable, protection, chute de tension", "calc"));

    const form = el(`<div class="ec-form"></div>`);
    form.appendChild(el(`<div class="ec-seg">
      <button class="ec-seg-b ${st.mode === "puissance" ? "on" : ""}" data-m="puissance">Par puissance (W)</button>
      <button class="ec-seg-b ${st.mode === "intensite" ? "on" : ""}" data-m="intensite">Par intensite (A)</button>
    </div>`));
    const dyn = el(`<div id="ec-dyn"></div>`);
    form.appendChild(dyn);
    form.appendChild(el(`<div class="row2">
      <label>Tension<select id="c-tension">
        <option value="mono">Monophase 230 V</option>
        <option value="tri">Triphase 400 V</option>
      </select></label>
      <label>Longueur de la ligne (m)<input id="c-long" type="number" min="0" step="1" value="${esc(st.longueur)}" placeholder="Ex : 20"></label>
    </div>`));
    form.appendChild(el(`<label>Type de circuit (chute de tension max admise)
      <select id="c-usage">
        <option value="ecl">Eclairage (3 %)</option>
        <option value="autre">Prises / autres usages (5 %)</option>
      </select></label>`));
    cont.appendChild(form);
    const res = el(`<div class="ec-res" id="c-res"></div>`);
    cont.appendChild(res);

    function peindreDyn() {
      if (st.mode === "puissance") {
        dyn.innerHTML = `<div class="row2">
          <label>Puissance (W)<input id="c-p" type="number" min="0" step="100" value="${esc(st.puissance)}" placeholder="Ex : 3500"></label>
          <label>Facteur de puissance<select id="c-cos">
            <option value="1">1 - resistif (chauffage, ECS)</option>
            <option value="0.85">0,85 - moteurs / mixte</option>
          </select></label>
        </div>`;
        dyn.querySelector("#c-p").addEventListener("input", (e) => { st.puissance = e.target.value; recalc(); });
        const cs = dyn.querySelector("#c-cos"); cs.value = String(st.cos);
        cs.addEventListener("change", (e) => { st.cos = parseFloat(e.target.value) || 1; recalc(); });
      } else {
        dyn.innerHTML = `<label>Intensite (A)<input id="c-i" type="number" min="0" step="1" value="${esc(st.intensite)}" placeholder="Ex : 16"></label>`;
        dyn.querySelector("#c-i").addEventListener("input", (e) => { st.intensite = e.target.value; recalc(); });
      }
    }
    form.querySelectorAll(".ec-seg-b").forEach((b) => b.addEventListener("click", () => {
      st.mode = b.dataset.m;
      form.querySelectorAll(".ec-seg-b").forEach((x) => x.classList.toggle("on", x.dataset.m === st.mode));
      peindreDyn(); recalc();
    }));
    const tens = form.querySelector("#c-tension"); tens.value = st.tension;
    const long = form.querySelector("#c-long");
    const usage = form.querySelector("#c-usage"); usage.value = st.usage;
    tens.addEventListener("change", (e) => { st.tension = e.target.value; recalc(); });
    long.addEventListener("input", (e) => { st.longueur = e.target.value; recalc(); });
    usage.addEventListener("change", (e) => { st.usage = e.target.value; recalc(); });
    peindreDyn();

    function recalc() {
      const mono = st.tension === "mono";
      const U = mono ? 230 : 400;
      let I;
      if (st.mode === "puissance") {
        const P = parseFloat(st.puissance) || 0;
        if (!P) { res.innerHTML = placeholderRes(); return; }
        I = mono ? P / (U * (st.cos || 1)) : P / (Math.sqrt(3) * U * (st.cos || 1));
      } else {
        I = parseFloat(st.intensite) || 0;
        if (!I) { res.innerHTML = placeholderRes(); return; }
      }
      // Calibre de protection : premier standard >= I (avec petite marge)
      const inDisj = CALIBRES.find((c) => c >= I - 0.01) || CALIBRES[CALIBRES.length - 1];
      // Section de base : plus petite section dont le calibre maxi couvre le disjoncteur
      let idx = SECTIONS.findIndex((x) => x.inMax >= inDisj);
      if (idx < 0) idx = SECTIONS.length - 1;
      const L = parseFloat(st.longueur) || 0;
      const limite = st.usage === "ecl" ? 3 : 5;
      const b = mono ? 2 : Math.sqrt(3);
      const chute = (S2) => 100 * (b * RHO_CUIVRE * L * I / S2) / U;
      // On augmente la section tant que la chute de tension depasse la limite
      let sExigee = idx, bump = false;
      while (sExigee < SECTIONS.length - 1 && chute(SECTIONS[sExigee].s) > limite) { sExigee++; bump = true; }
      const sec = SECTIONS[sExigee];
      const du = chute(sec.s);
      const duBase = chute(SECTIONS[idx].s);
      const ok = du <= limite + 1e-9;
      res.innerHTML = `
        <div class="ec-res-t">Resultat</div>
        <div class="ec-res-row"><span>Intensite du circuit</span><b>${I.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} A</b></div>
        <div class="ec-res-row"><span>Disjoncteur de protection</span><b>${inDisj} A</b></div>
        <div class="ec-res-main"><span>Section de cable conseillee</span><strong>${String(sec.s).replace(".", ",")} mm² cuivre</strong></div>
        ${bump ? `<div class="ec-res-row warn"><span>Section relevee pour la longueur</span><b>${String(SECTIONS[idx].s).replace(".", ",")} -> ${String(sec.s).replace(".", ",")} mm²</b></div>` : ""}
        <div class="ec-res-row"><span>Chute de tension (${L || 0} m)</span><b class="${ok ? "ec-ok" : "ec-bad"}">${du.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} % / ${limite} % max</b></div>
        <div class="ec-verdict ${ok ? "ok" : "bad"}">${ok ? "Conforme pour cette longueur" : "Chute de tension trop forte, rallonger impossible sans grossir la section"}</div>
        <p class="ec-res-note">Cuivre, rho = 0,0225 ohm.mm²/m. ${duBase.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} % avec la section mini ${String(SECTIONS[idx].s).replace(".", ",")} mm². Valeurs indicatives, mode de pose non pris en compte.</p>`;
    }
    function placeholderRes() {
      return `<div class="ec-res-t">Resultat</div><p class="ec-res-note">Saisissez une ${st.mode === "puissance" ? "puissance" : "intensite"} pour lancer le calcul.</p>`;
    }
    recalc();
    return cont;
  }

  // ----- Table de reference des circuits normalises -----
  const TABLE_CIRCUITS = [
    { usage: "Eclairage", section: "1,5 mm²", protection: "16 A (ou 10 A)", points: "8 points lumineux max" },
    { usage: "Prises 16 A (2,5 mm²)", section: "2,5 mm²", protection: "20 A", points: "12 prises max" },
    { usage: "Prises 16 A (1,5 mm²)", section: "1,5 mm²", protection: "16 A", points: "8 prises max" },
    { usage: "Prises plan de travail cuisine", section: "2,5 mm²", protection: "20 A", points: "6 prises min (dont 4 sur plan)" },
    { usage: "Circuit specialise (LL, LV, four)", section: "2,5 mm²", protection: "20 A", points: "1 appareil dedie" },
    { usage: "Plaque de cuisson (mono)", section: "6 mm²", protection: "32 A", points: "1 circuit dedie" },
    { usage: "Plaque de cuisson (triphase)", section: "2,5 mm²", protection: "20 A", points: "1 circuit dedie" },
    { usage: "Chauffe-eau", section: "2,5 mm²", protection: "20 A", points: "circuit dedie + contacteur" },
    { usage: "Chauffage <= 4500 W", section: "1,5 mm²", protection: "16 A", points: "par fil pilote possible" },
    { usage: "Chauffage <= 5750 W", section: "2,5 mm²", protection: "25 A", points: "circuit dedie" },
    { usage: "Chauffage <= 7250 W", section: "6 mm²", protection: "32 A", points: "circuit dedie" },
    { usage: "VMC", section: "1,5 mm²", protection: "2 A", points: "circuit dedie" },
    { usage: "Volets roulants", section: "1,5 mm²", protection: "16 A", points: "-" },
    { usage: "Borne de recharge VE 7,4 kW", section: "6 mm²", protection: "40 A", points: "circuit dedie + diff 30 mA type A/B" },
  ];
  function sectionCalcTable() {
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Table des circuits", "Sections et protections normalisees (NF C 15-100)", "calc"));
    const wrap = el(`<div class="ec-table-wrap"></div>`);
    const t = el(`<table class="ec-table">
      <thead><tr><th>Usage</th><th>Section</th><th>Protection</th><th>Regle</th></tr></thead>
      <tbody></tbody></table>`);
    const tb = t.querySelector("tbody");
    TABLE_CIRCUITS.forEach((r) => {
      tb.appendChild(el(`<tr><td>${esc(r.usage)}</td><td class="ec-mono">${esc(r.section)}</td><td class="ec-mono">${esc(r.protection)}</td><td class="ec-small">${esc(r.points)}</td></tr>`));
    });
    wrap.appendChild(t);
    cont.appendChild(wrap);
    cont.appendChild(el(`<p class="pl-note">Valeurs de reference pour un logement (cuivre). Toujours verifier selon le mode de pose et la version en vigueur de la norme.</p>`));
    return cont;
  }

  // =====================================================================
  //  CATALOGUE
  // =====================================================================
  async function sectionCatalogue() {
    const list = await store.catalogue();
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Catalogue de prestations", "Vos tarifs electricite (HT)", "accueil"));
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
    const unites = ["forfait", "heure", "unite", "point", "m", "ml", "m2", "jour"];
    const opts = unites.map((u) => `<option value="${u}" ${u === d.unite ? "selected" : ""}>${u}</option>`).join("");
    const sheet = el(`
      <div class="modal">
        <div class="sheet">
          <div class="sheet-head"><h2>${edition ? "Modifier la prestation" : "Nouvelle prestation"}</h2><button class="x" id="close">&times;</button></div>
          <div class="sheet-body">
            <label>Libelle<input id="p-lib" type="text" value="${esc(d.libelle)}" placeholder="Ex : Pose prise de courant"></label>
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

  // =====================================================================
  //  DOCUMENTS
  // =====================================================================
  async function sectionDocuments() {
    const infos = await store.infos();
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Documents", "Attestations pretes a imprimer", "accueil"));
    const grid = el(`<div class="pl-cards"></div>`);
    const cInfos = carteNav(I.building, "Infos de mon entreprise", infos && infos.raisonSociale ? esc(infos.raisonSociale) : "A renseigner", () => formInfos());
    if (!infos || !infos.raisonSociale) cInfos.classList.add("warn");
    grid.appendChild(cInfos);
    grid.appendChild(carteNav(I.bolt, "Attestation de conformite", "Installation electrique NF C 15-100", () => formConformite()));
    grid.appendChild(carteNav(I.file, "Attestation TVA 10 %", "Travaux de renovation (logement > 2 ans)", () => formAttestationTVA()));
    cont.appendChild(grid);
    cont.appendChild(el(`<p class="pl-note">L'attestation de conformite est une <b>attestation sur l'honneur de l'entreprise</b>. Elle ne remplace pas le <b>Consuel</b> officiel, obligatoire pour la mise en service d'une installation neuve ou entierement renovee.</p>`));
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
              <p class="reg-hint">Ces informations apparaissent en en-tete de vos attestations. Elles restent sur votre appareil et sont partagees avec vos autres modules metier.</p>
              <label>Raison sociale<input id="i-rs" type="text" value="${esc(d.raisonSociale)}" placeholder="Ex : Electricite Martin"></label>
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
        // On conserve une eventuelle signature enregistree
        if (infos && infos.signatureTech) nd.signatureTech = infos.signatureTech;
        if (!nd.raisonSociale) { toast("Indiquez au moins la raison sociale."); return; }
        await store.setInfos(nd);
        close();
        repaint();
        toast("Infos entreprise enregistrees.");
      });
      document.getElementById("app").appendChild(sheet);
    });
  }

  // ----- Attestation de conformite NF C 15-100 -----
  const CONTROLES_CONFORMITE = [
    "Prise de terre et liaisons equipotentielles realisees",
    "Dispositif differentiel 30 mA sur tous les circuits",
    "Disjoncteurs adaptes a la section des conducteurs",
    "Sections des conducteurs conformes aux usages",
    "Tableau de repartition repere et accessible",
    "Protection des circuits specialises (cuisson, ECS, LL/LV)",
  ];
  function formConformite() {
    store.infos().then((infos) => {
      if (!infos || !infos.raisonSociale) { toast("Renseignez d'abord les infos de votre entreprise."); formInfos(); return; }
      const sigEnregistree = !!infos.signatureTech;
      const controlesHtml = CONTROLES_CONFORMITE.map((c, i) =>
        `<label class="ec-ctrl"><input type="checkbox" id="k-${i}" checked><span>${esc(c)}</span></label>`).join("");
      const sheet = el(`
        <div class="modal">
          <div class="sheet">
            <div class="sheet-head"><h2>Attestation de conformite</h2><button class="x" id="close">&times;</button></div>
            <div class="sheet-body">
              <p class="reg-hint">Attestation sur l'honneur que l'installation realisee respecte la norme NF C 15-100. Ne remplace pas le Consuel officiel.</p>
              <label>Nom du client<input id="k-client" type="text" placeholder="Nom et prenom"></label>
              <label>Adresse de l'installation<input id="k-adresse" type="text" placeholder="Adresse des travaux"></label>
              <label>Nature de l'installation<select id="k-nature">
                <option value="Installation neuve">Installation neuve</option>
                <option value="Renovation totale">Renovation totale</option>
                <option value="Renovation partielle">Renovation partielle</option>
                <option value="Mise en securite">Mise en securite</option>
              </select></label>
              <label>Description des travaux<textarea id="k-desc" rows="2" placeholder="Ex : refection du tableau, mise a la terre, 3 circuits prises..."></textarea></label>
              <div class="ec-ctrl-box">
                <div class="sig-lab">Points controles</div>
                ${controlesHtml}
              </div>
              <label>Reserves / observations<textarea id="k-obs" rows="2" placeholder="Ex : aucune reserve"></textarea></label>
              <div class="row2">
                <label>Fait a (ville)<input id="k-ville" type="text" placeholder="Ex : Le Creusot"></label>
                <label>Date<input id="k-date" type="date" value="${esc(todayISO())}"></label>
              </div>
              <div class="sig-bloc">
                <div class="sig-lab">Signature de l'entreprise ${sigEnregistree ? '<span class="sig-hint">(signature enregistree : laissez vide pour la reutiliser)</span>' : ""}</div>
                <canvas class="sig-pad" id="sig-k-ent"></canvas>
                <div class="sig-actions">
                  <button type="button" class="mini" id="sig-k-ent-clear">Effacer</button>
                  <label class="sig-save"><input type="checkbox" id="sig-k-ent-save"> Enregistrer ma signature</label>
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

      const padEnt = creerSignaturePad(sheet.querySelector("#sig-k-ent"));
      sheet.querySelector("#sig-k-ent-clear").addEventListener("click", () => padEnt.effacer());

      sheet.querySelector("#gen").addEventListener("click", async () => {
        const client = sheet.querySelector("#k-client").value.trim();
        const adresse = sheet.querySelector("#k-adresse").value.trim();
        if (!client || !adresse) { toast("Renseignez le client et l'adresse."); return; }
        let sigEnt = padEnt.dataURL();
        if (!sigEnt && infos.signatureTech) sigEnt = infos.signatureTech;
        if (padEnt.dataURL() && sheet.querySelector("#sig-k-ent-save").checked) {
          infos.signatureTech = padEnt.dataURL();
          await store.setInfos(infos);
        }
        const controles = CONTROLES_CONFORMITE.filter((_, i) => sheet.querySelector("#k-" + i).checked);
        close();
        const data = {
          infos, client, adresse,
          nature: sheet.querySelector("#k-nature").value,
          desc: sheet.querySelector("#k-desc").value.trim(),
          controles,
          observations: sheet.querySelector("#k-obs").value.trim(),
          ville: sheet.querySelector("#k-ville").value.trim(),
          dateFR: fmtFR(sheet.querySelector("#k-date").value || todayISO()),
          sigEntSrc: sigEnt,
        };
        const canvas = await construireCanvasConformite(data);
        const nom = "Attestation_conformite_" + (client || "client").replace(/[^a-zA-Z0-9]+/g, "_") + ".png";
        apercuImage(canvas, nom, "Attestation de conformite");
      });
    });
  }

  // ----- Attestation TVA taux reduit (brique commune, meme logique que plombier) -----
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
              <label>Nature des travaux<textarea id="t-nature" rows="3" placeholder="Ex : renovation du tableau electrique, mise aux normes..."></textarea></label>
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
        const nom = "Attestation_TVA_" + (client || "client").replace(/[^a-zA-Z0-9]+/g, "_") + ".png";
        apercuImage(canvas, nom, "Attestation TVA");
      });
    });
  }

  // ---------- Signature tactile (brique commune) ----------
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

  // ---------- Rendu canvas (briques communes) ----------
  function chargerImg(src) {
    return new Promise((res) => {
      if (!src) { res(null); return; }
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
  }
  function wrapTexte(ctx, texte, maxW) {
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

  // Attestation de conformite (image)
  async function construireCanvasConformite(data) {
    const imgEnt = await chargerImg(data.sigEntSrc);
    const W = 1240, M = 90, cW = W - M * 2;

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
      if (draw) ctx.fillText("ATTESTATION DE CONFORMITE", W / 2, y); y += 46;
      ctx.font = "21px Arial"; ctx.fillStyle = "#55617a";
      if (draw) ctx.fillText("Installation electrique - norme NF C 15-100", W / 2, y); y += 40;
      ctx.textAlign = "left";
      // Intro
      ctx.fillStyle = "#1a2230"; ctx.font = "22px Arial";
      wrapTexte(ctx, "Je soussigne, representant la societe " + data.infos.raisonSociale + ", atteste sur l'honneur que l'installation electrique decrite ci-dessous a ete realisee conformement aux regles de l'art et aux prescriptions de la norme NF C 15-100 en vigueur.", cW)
        .forEach((l) => { if (draw) ctx.fillText(l, M, y); y += 30; });
      y += 16;
      // Tableau infos
      const tableau = (rows) => {
        rows.forEach(([lab, v]) => {
          const labW = cW * 0.4;
          const vLignes = wrapTexte(ctx, v || "-", cW - labW - 24);
          const rowH = Math.max(42, 14 + vLignes.length * 26);
          if (draw) {
            ctx.strokeStyle = "#dde3ee"; ctx.lineWidth = 1; ctx.strokeRect(M, y, cW, rowH);
            ctx.fillStyle = "#f6f8fc"; ctx.fillRect(M, y, labW, rowH); ctx.strokeRect(M, y, labW, rowH);
            ctx.fillStyle = "#55617a"; ctx.font = "600 20px Arial"; ctx.fillText(lab, M + 12, y + 11);
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
        ["Adresse de l'installation", data.adresse || "-"],
        ["Nature de l'installation", data.nature || "-"],
        ["Description des travaux", data.desc || "-"],
      ]);
      // Points controles (cases cochees)
      sectionTitre("Points controles");
      ctx.fillStyle = "#1a2230"; ctx.font = "21px Arial";
      (data.controles && data.controles.length ? data.controles : ["Aucun point coche"]).forEach((c) => {
        const lignes = wrapTexte(ctx, c, cW - 44);
        if (draw) {
          ctx.strokeStyle = "#1a2230"; ctx.lineWidth = 1.6; ctx.strokeRect(M, y + 1, 20, 20);
          ctx.beginPath(); ctx.moveTo(M + 4, y + 11); ctx.lineTo(M + 9, y + 16); ctx.lineTo(M + 16, y + 4); ctx.strokeStyle = "#0f7a3f"; ctx.lineWidth = 2.4; ctx.stroke();
        }
        lignes.forEach((l, i) => { if (draw) { ctx.fillStyle = "#1a2230"; ctx.font = "21px Arial"; ctx.fillText(l, M + 36, y + i * 27); } });
        y += Math.max(30, lignes.length * 27) + 8;
      });
      if (data.observations) {
        sectionTitre("Reserves / observations");
        ctx.fillStyle = "#1a2230"; ctx.font = "21px Arial";
        wrapTexte(ctx, data.observations, cW).forEach((l) => { if (draw) ctx.fillText(l, M, y); y += 29; });
      }
      // Fait a
      y += 22; ctx.fillStyle = "#1a2230"; ctx.font = "22px Arial";
      if (draw) ctx.fillText("Fait a " + (data.ville || "...................") + ", le " + data.dateFR, M, y);
      y += 44;
      // Signature entreprise
      const boxW = (cW - 40) / 2, boxH = 190;
      if (draw) {
        ctx.strokeStyle = "#c7cfe0"; ctx.lineWidth = 1; ctx.strokeRect(M + boxW + 40, y, boxW, boxH);
        ctx.fillStyle = "#55617a"; ctx.font = "600 18px Arial"; ctx.fillText("Cachet et signature de l'entreprise", M + boxW + 52, y + 10);
        if (imgEnt) {
          const pad = 16, availW = boxW - pad * 2, availH = boxH - 48;
          const scale = Math.min(availW / imgEnt.width, availH / imgEnt.height, 1);
          const w = imgEnt.width * scale, h = imgEnt.height * scale;
          ctx.drawImage(imgEnt, M + boxW + 40 + (boxW - w) / 2, y + 40 + (availH - h) / 2, w, h);
        }
      }
      y += boxH + 26;
      if (draw) {
        ctx.strokeStyle = "#dde3ee"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
        ctx.fillStyle = "#8892a6"; ctx.font = "17px Arial"; ctx.textAlign = "center";
        ctx.fillText("Attestation sur l'honneur. Ne remplace pas l'attestation Consuel pour la mise en service.", W / 2, y + 12);
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

  // Attestation TVA (image) - meme mise en forme que le pack Plombier
  async function construireCanvasTVA(data) {
    const imgClient = await chargerImg(data.sigClientSrc);
    const imgEnt = await chargerImg(data.sigEntSrc);
    const tauxTxt = data.taux === "5.5" ? "5,5 %" : "10 %";
    const W = 1240, M = 90, cW = W - M * 2;

    function render(ctx, draw) {
      let y = 78;
      ctx.textBaseline = "top"; ctx.textAlign = "left";
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
      ctx.textAlign = "center"; ctx.fillStyle = "#0f1720"; ctx.font = "700 36px Arial";
      if (draw) ctx.fillText("ATTESTATION SIMPLIFIEE", W / 2, y); y += 46;
      ctx.font = "20px Arial"; ctx.fillStyle = "#55617a";
      wrapTexte(ctx, "Taux de TVA reduit de " + tauxTxt + " sur les travaux (articles 279-0 bis et 278-0 bis A du CGI)", cW)
        .forEach((l) => { if (draw) ctx.fillText(l, W / 2, y); y += 28; });
      y += 14; ctx.textAlign = "left";
      ctx.fillStyle = "#1a2230"; ctx.font = "22px Arial";
      wrapTexte(ctx, "Je soussigne(e) " + data.client + ", client, atteste que les travaux realises par l'entreprise " + data.infos.raisonSociale + " a l'adresse ci-dessous portent sur un local repondant aux conditions suivantes :", cW)
        .forEach((l) => { if (draw) ctx.fillText(l, M, y); y += 30; });
      y += 16;
      const tableau = (rows) => {
        rows.forEach(([lab, v]) => {
          const labW = cW * 0.4;
          const vLignes = wrapTexte(ctx, v || "-", cW - labW - 24);
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
      y += 16;
      ctx.fillStyle = "#0f1720"; ctx.font = "700 23px Arial";
      if (draw) { ctx.fillText("Le client atteste que :", M, y); ctx.strokeStyle = "#dde3ee"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, y + 30); ctx.lineTo(W - M, y + 30); ctx.stroke(); }
      y += 44;
      ctx.fillStyle = "#1a2230"; ctx.font = "21px Arial";
      ["le local est acheve depuis plus de deux ans a la date de debut des travaux ;",
        "il est affecte a l'habitation (residence principale ou secondaire) ;",
        "les travaux ne concourent pas a la production d'un immeuble neuf ni n'augmentent la surface de plancher de plus de 10 %."].forEach((it) => {
          const lignes = wrapTexte(ctx, it, cW - 40);
          if (draw) { ctx.strokeStyle = "#1a2230"; ctx.lineWidth = 1.6; ctx.strokeRect(M, y + 1, 20, 20); }
          lignes.forEach((l, i) => { if (draw) ctx.fillText(l, M + 36, y + i * 27); });
          y += Math.max(30, lignes.length * 27) + 8;
        });
      y += 6; ctx.fillStyle = "#46506a"; ctx.font = "20px Arial";
      wrapTexte(ctx, "Le client conserve une copie de cette attestation et la remet a l'entreprise, qui la joint a sa facture. Cette attestation engage la responsabilite du client sur l'exactitude des informations declarees.", cW)
        .forEach((l) => { if (draw) ctx.fillText(l, M, y); y += 28; });
      y += 20; ctx.fillStyle = "#1a2230"; ctx.font = "22px Arial";
      if (draw) ctx.fillText("Fait a " + (data.ville || "...................") + ", le " + data.dateFR, M, y);
      y += 44;
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

  // ---------- Apercu image : imprimer ou envoyer (brique commune) ----------
  function apercuImage(canvas, nomFichier, titre) {
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
        <div class="doc-sheet doc-img"><img alt="${esc(titre || "Document")}" src="${dataUrl}"></div>
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
      canvas.toBlob((blob) => { if (blob) partager(blob, nomFichier, titre); }, "image/png");
    });
  }

  async function partager(blob, nomFichier, titre) {
    const file = new File([blob], nomFichier, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: titre || "Document" }); }
      catch (e) { /* partage annule */ }
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = nomFichier; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast("Partage direct indisponible ici : le fichier a ete telecharge.");
    }
  }

  // ---------- API publique du module ----------
  S.electricien = {
    page,
    reset() { estate.section = "accueil"; },
  };
})();
