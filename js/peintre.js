/*
 * peintre.js - Module payant "Pack Peintre en batiment" de ClicChantier.
 *
 * 3e module METIER (apres plombier.js et electricien.js). Il ne s'affiche que si
 * l'entreprise a le droit "peintre" (features.actif("peintre")). Il couvre le
 * vrai perimetre d'un peintre en batiment : placo, enduit, peinture, tapisserie.
 * Les 3 briques concretes d'un pack metier :
 *   1. Calculateurs de metre (la vedette), 5 outils :
 *        - Surface a peindre / traiter (base commune, deduction des ouvertures)
 *        - Placo / cloisons seches : plaques, ossature, vis, bande, enduit a joint
 *        - Enduit / ratissage : kg d'enduit, sacs, passes
 *        - Peinture : litres, nombre de pots, cout matiere
 *        - Tapisserie / revetements : rouleaux de papier peint (avec raccord),
 *          toile de verre, colle
 *   2. Catalogue de prestations peintre pre-rempli et editable (4 poles).
 *   3. Documents signes : PV de reception des travaux + attestation TVA.
 *
 * Autonome, comme plombier.js / electricien.js : helpers propres, stockage propre.
 * Il PARTAGE volontairement les infos d'entreprise (meme cle localStorage) et la
 * signature enregistree : c'est la meme entreprise. Aucun accent dans le code
 * (coherent avec les autres modules).
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
  // Nombre format FR compact (1 decimale max sauf entier)
  function num(n, dec) {
    const v = Number(n) || 0;
    return v.toLocaleString("fr-FR", { maximumFractionDigits: dec == null ? 1 : dec });
  }
  function uid() {
    return "pt_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }
  function toast(msg) {
    const t = el(`<div class="pl-toast">${esc(msg)}</div>`);
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2600);
  }

  // ---------- Icones locales ----------
  const I = {
    roller: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="14" height="7" rx="1.5"/><path d="M17 6h3v4h-8M12 10v3a2 2 0 0 0 2 2h0M12 15v6"/></svg>',
    calc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15h6M9 11h2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/></svg>',
    ruler: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l12-6 6 12-12 6z" transform="rotate(45 12 12)"/><path d="M14.5 4.5l1.5 1.5M11.5 7.5l1.5 1.5M8.5 10.5l1.5 1.5M5.5 13.5l1.5 1.5"/></svg>',
    wall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M3 15h18M9 4v6M15 10v5M9 15v5"/></svg>',
    trowel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14l6 6 8-8-6-6-8 8zM15 6l3-3a2 2 0 0 1 3 3l-3 3"/></svg>',
    paint: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="12" height="8" rx="1"/><path d="M16 6h3a1 1 0 0 1 1 1v3a2 2 0 0 1-2 2h-5M10 13v3a2 2 0 0 0 2 2h0a2 2 0 0 1 2 2v2"/></svg>',
    paper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h10a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z"/><path d="M16 6h2a2 2 0 0 1 2 2v10M8 8h4M8 12h4M8 16h4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  };

  // ---------- Stockage (async, pret pour le cloud) ----------
  // Infos entreprise : MEME cle que plombier.js / electricien.js (infos partagees).
  const K_INFOS = "chantier_docs_infos_v1";
  // Catalogue propre au peintre (cle distincte).
  const K_CATALOGUE = "chantier_catalogue_peintre_v1";

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

  // Catalogue de prestations peintre pre-rempli (tarifs HT indicatifs, 4 poles).
  const CATALOGUE_DEFAUT = [
    { libelle: "Deplacement + protection chantier (sols, mobilier)", unite: "forfait", prixHT: 60 },
    { libelle: "Main d'oeuvre peintre", unite: "heure", prixHT: 40 },
    { libelle: "Rebouchage / preparation des supports", unite: "m2", prixHT: 6 },
    { libelle: "Poncage des surfaces", unite: "m2", prixHT: 5 },
    { libelle: "Ratissage / enduit de lissage (2 passes)", unite: "m2", prixHT: 12 },
    { libelle: "Bande a joint sur placo", unite: "ml", prixHT: 4 },
    { libelle: "Pose cloison placo 72/48 (BA13)", unite: "m2", prixHT: 38 },
    { libelle: "Pose doublage placo + isolant", unite: "m2", prixHT: 42 },
    { libelle: "Pose plafond placo sur ossature", unite: "m2", prixHT: 45 },
    { libelle: "Sous-couche d'impression", unite: "m2", prixHT: 5 },
    { libelle: "Peinture murs 2 couches (acrylique)", unite: "m2", prixHT: 14 },
    { libelle: "Peinture plafond 2 couches", unite: "m2", prixHT: 16 },
    { libelle: "Peinture boiseries / laque (porte, plinthe)", unite: "unite", prixHT: 45 },
    { libelle: "Pose toile de verre + mise en peinture", unite: "m2", prixHT: 22 },
    { libelle: "Pose papier peint", unite: "m2", prixHT: 18 },
    { libelle: "Peinture facade (ravalement)", unite: "m2", prixHT: 30 },
    { libelle: "Nettoyage et repli de chantier", unite: "forfait", prixHT: 50 },
  ];

  // Entreprise fictive par defaut (mode demo). Partagee avec les autres packs :
  // si un autre pack a deja rempli ses infos, elles sont reprises telles quelles.
  const INFOS_DEFAUT = {
    raisonSociale: "SARL Peinture & Decoration Bourgogne",
    siret: "81234567800031",
    adresse: "8 rue des Artisans, 71200 Le Creusot",
    tel: "03 85 55 20 10",
    email: "contact@peinture-bourgogne.fr",
    assureur: "MAAF Pro",
    assurancePolice: "PEI-2024-44120",
    tvaIntra: "FR60812345678",
  };

  // Derniere surface calculee (pont entre le calculateur "Surface" et les autres).
  let derniereSurface = 0;

  // ---------- Etat interne du module ----------
  const estate = { section: "accueil" };
  function go(section) { estate.section = section; S.rerender(); }
  function repaint() { S.rerender(); }

  // =====================================================================
  //  PAGE : renvoie le noeud de la section courante
  // =====================================================================
  async function page() {
    if (estate.section === "calc") return sectionCalcMenu();
    if (estate.section === "calc_surface") return sectionCalcSurface();
    if (estate.section === "calc_placo") return sectionCalcPlaco();
    if (estate.section === "calc_enduit") return sectionCalcEnduit();
    if (estate.section === "calc_peinture") return sectionCalcPeinture();
    if (estate.section === "calc_tapisserie") return sectionCalcTapisserie();
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
    cont.appendChild(enteteSection("Pack Peintre", "Vos outils metier", undefined));

    const grid = el(`<div class="pl-cards"></div>`);
    grid.appendChild(carteNav(I.calc, "Calculateurs de metre", "Placo, enduit, peinture, tapisserie", () => go("calc")));
    grid.appendChild(carteNav(I.list, "Catalogue de prestations", "Vos tarifs peinture et decoration", () => go("catalogue")));
    grid.appendChild(carteNav(I.file, "Documents", "PV de reception et attestation TVA", () => go("documents")));
    cont.appendChild(grid);

    if (!infos || !infos.raisonSociale) {
      const warn = el(`
        <button class="pl-info-warn">
          ${I.building}
          <div><b>Renseignez les infos de votre entreprise</b><span>Necessaires pour editer les documents (raison sociale, SIRET, assurance...).</span></div>
        </button>`);
      warn.addEventListener("click", () => go("documents"));
      cont.appendChild(warn);
    }
    return cont;
  }

  // =====================================================================
  //  CALCULATEURS
  // =====================================================================
  function sectionCalcMenu() {
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Calculateurs de metre", "Aide au chiffrage du chantier", "accueil"));
    const grid = el(`<div class="pl-cards"></div>`);
    grid.appendChild(carteNav(I.ruler, "Surface a peindre", "Metre des murs et plafond, deduction des ouvertures", () => go("calc_surface")));
    grid.appendChild(carteNav(I.wall, "Placo / cloisons seches", "Plaques, ossature, vis, bande, enduit a joint", () => go("calc_placo")));
    grid.appendChild(carteNav(I.trowel, "Enduit / ratissage", "Kilos d'enduit, sacs, nombre de passes", () => go("calc_enduit")));
    grid.appendChild(carteNav(I.paint, "Peinture", "Litres, nombre de pots, cout matiere", () => go("calc_peinture")));
    grid.appendChild(carteNav(I.paper, "Tapisserie / revetements", "Papier peint (avec raccord), toile de verre, colle", () => go("calc_tapisserie")));
    cont.appendChild(grid);
    cont.appendChild(el(`<p class="pl-note">Ces outils sont une <b>aide au chiffrage</b>. Les rendements sont indicatifs et dependent du support, de la teinte et de la mise en oeuvre. Prevoyez toujours une marge.</p>`));
    return cont;
  }

  // Petit rappel de la derniere surface calculee, avec bouton de report.
  function blocReport(inputEl) {
    if (!derniereSurface) return null;
    const b = el(`<button type="button" class="pl-report">Reporter la derniere surface calculee : <b>${num(derniereSurface)} m²</b></button>`);
    b.addEventListener("click", () => { inputEl.value = num(derniereSurface, 2); inputEl.dispatchEvent(new Event("input")); });
    return b;
  }

  // ----- 1. Surface a peindre / traiter -----
  function sectionCalcSurface() {
    const st = sectionCalcSurface._st || (sectionCalcSurface._st = {
      mode: "piece", L: "", l: "", H: "2.5", murSaisi: "", plafSaisi: "",
      murs: true, plafond: false, portes: "", fenetres: "", autres: "",
    });
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Surface a peindre", "Metre net des murs et du plafond", "calc"));

    const form = el(`<div class="ec-form"></div>`);
    form.appendChild(el(`<div class="ec-seg">
      <button class="ec-seg-b ${st.mode === "piece" ? "on" : ""}" data-m="piece">Par dimensions</button>
      <button class="ec-seg-b ${st.mode === "direct" ? "on" : ""}" data-m="direct">Surfaces connues</button>
    </div>`));
    const dyn = el(`<div id="pt-dyn"></div>`);
    form.appendChild(dyn);
    form.appendChild(el(`<div class="ec-checks" id="pt-quoi">
      <label class="ec-check"><input type="checkbox" id="q-murs" ${st.murs ? "checked" : ""}><span class="ec-check-l">Murs</span></label>
      <label class="ec-check"><input type="checkbox" id="q-plaf" ${st.plafond ? "checked" : ""}><span class="ec-check-l">Plafond</span></label>
    </div>`));
    form.appendChild(el(`<div class="row2">
      <label>Portes (nb, -2 m² chacune)<input id="s-portes" type="number" min="0" step="1" value="${esc(st.portes)}" placeholder="0"></label>
      <label>Fenetres (nb, -1,5 m² ch.)<input id="s-fen" type="number" min="0" step="1" value="${esc(st.fenetres)}" placeholder="0"></label>
    </div>`));
    form.appendChild(el(`<label>Autres deductions (m²)<input id="s-autres" type="number" min="0" step="0.5" value="${esc(st.autres)}" placeholder="Ex : baie, placard..."></label>`));
    cont.appendChild(form);
    const res = el(`<div class="ec-res" id="s-res"></div>`);
    cont.appendChild(res);

    function peindreDyn() {
      if (st.mode === "piece") {
        dyn.innerHTML = `<div class="row2">
            <label>Longueur (m)<input id="s-long" type="number" min="0" step="0.1" value="${esc(st.L)}" placeholder="Ex : 4"></label>
            <label>Largeur (m)<input id="s-larg" type="number" min="0" step="0.1" value="${esc(st.l)}" placeholder="Ex : 3"></label>
          </div>
          <label>Hauteur sous plafond (m)<input id="s-haut" type="number" min="0" step="0.05" value="${esc(st.H)}" placeholder="Ex : 2,5"></label>`;
        dyn.querySelector("#s-long").addEventListener("input", (e) => { st.L = e.target.value; recalc(); });
        dyn.querySelector("#s-larg").addEventListener("input", (e) => { st.l = e.target.value; recalc(); });
        dyn.querySelector("#s-haut").addEventListener("input", (e) => { st.H = e.target.value; recalc(); });
      } else {
        dyn.innerHTML = `<div class="row2">
            <label>Surface des murs (m²)<input id="s-mur" type="number" min="0" step="0.5" value="${esc(st.murSaisi)}" placeholder="Ex : 35"></label>
            <label>Surface plafond (m²)<input id="s-plaf" type="number" min="0" step="0.5" value="${esc(st.plafSaisi)}" placeholder="Ex : 12"></label>
          </div>`;
        dyn.querySelector("#s-mur").addEventListener("input", (e) => { st.murSaisi = e.target.value; recalc(); });
        dyn.querySelector("#s-plaf").addEventListener("input", (e) => { st.plafSaisi = e.target.value; recalc(); });
      }
    }
    form.querySelectorAll(".ec-seg-b").forEach((b) => b.addEventListener("click", () => {
      st.mode = b.dataset.m;
      form.querySelectorAll(".ec-seg-b").forEach((x) => x.classList.toggle("on", x.dataset.m === st.mode));
      peindreDyn(); recalc();
    }));
    form.querySelector("#q-murs").addEventListener("change", (e) => { st.murs = e.target.checked; recalc(); });
    form.querySelector("#q-plaf").addEventListener("change", (e) => { st.plafond = e.target.checked; recalc(); });
    form.querySelector("#s-portes").addEventListener("input", (e) => { st.portes = e.target.value; recalc(); });
    form.querySelector("#s-fen").addEventListener("input", (e) => { st.fenetres = e.target.value; recalc(); });
    form.querySelector("#s-autres").addEventListener("input", (e) => { st.autres = e.target.value; recalc(); });
    peindreDyn();

    function recalc() {
      let murs = 0, plafond = 0;
      if (st.mode === "piece") {
        const L = parseFloat(st.L) || 0, l = parseFloat(st.l) || 0, H = parseFloat(st.H) || 0;
        murs = 2 * (L + l) * H;
        plafond = L * l;
      } else {
        murs = parseFloat(st.murSaisi) || 0;
        plafond = parseFloat(st.plafSaisi) || 0;
      }
      const deduc = (parseFloat(st.portes) || 0) * 2 + (parseFloat(st.fenetres) || 0) * 1.5 + (parseFloat(st.autres) || 0);
      const mursNet = Math.max(0, murs - deduc);
      let total = 0;
      if (st.murs) total += mursNet;
      if (st.plafond) total += plafond;
      derniereSurface = total;
      res.innerHTML = `
        <div class="ec-res-t">Resultat</div>
        <div class="ec-res-row"><span>Surface des murs (brute)</span><b>${num(murs, 2)} m²</b></div>
        <div class="ec-res-row"><span>Deduction des ouvertures</span><b>- ${num(deduc, 2)} m²</b></div>
        <div class="ec-res-row"><span>Murs nets</span><b>${num(mursNet, 2)} m²</b></div>
        <div class="ec-res-row"><span>Plafond</span><b>${num(plafond, 2)} m²</b></div>
        <div class="ec-res-main"><span>Surface a traiter${st.murs && st.plafond ? " (murs + plafond)" : st.plafond ? " (plafond)" : " (murs)"}</span><strong>${num(total, 2)} m²</strong></div>
        <p class="ec-res-note">Report automatique vers les autres calculateurs (placo, enduit, peinture, tapisserie).</p>`;
    }
    recalc();
    return cont;
  }

  // ----- 2. Placo / cloisons seches -----
  const FORMATS_PLAQUE = [
    { cle: "250", label: "2,50 x 1,20 m (3,00 m²)", surf: 3.0 },
    { cle: "260", label: "2,60 x 1,20 m (3,12 m²)", surf: 3.12 },
    { cle: "300", label: "3,00 x 1,20 m (3,60 m²)", surf: 3.6 },
  ];
  function sectionCalcPlaco() {
    const st = sectionCalcPlaco._st || (sectionCalcPlaco._st = {
      surface: "", format: "250", chutes: "10", ouvrage: "cloison",
      longueur: "", hauteur: "2.5", entraxe: "0.6",
    });
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Placo / cloisons seches", "Plaques, ossature et consommables", "calc"));

    const form = el(`<div class="ec-form"></div>`);
    const labSurf = el(`<label>Surface a couvrir (m²)<input id="pc-surf" type="number" min="0" step="0.5" value="${esc(st.surface)}" placeholder="Ex : 20"></label>`);
    form.appendChild(labSurf);
    const rep = blocReport(labSurf.querySelector("input"));
    if (rep) form.appendChild(rep);
    form.appendChild(el(`<div class="row2">
      <label>Format de plaque<select id="pc-format">
        ${FORMATS_PLAQUE.map((f) => `<option value="${f.cle}" ${f.cle === st.format ? "selected" : ""}>${f.label}</option>`).join("")}
      </select></label>
      <label>Chutes / pertes (%)<input id="pc-chutes" type="number" min="0" step="1" value="${esc(st.chutes)}"></label>
    </div>`));
    form.appendChild(el(`<label>Type d'ouvrage<select id="pc-ouvrage">
      <option value="cloison">Cloison (2 faces a plaquer)</option>
      <option value="doublage">Doublage (1 face)</option>
      <option value="plafond">Plafond</option>
    </select></label>`));
    form.appendChild(el(`<div class="ec-sub">Ossature (optionnel, pour rails et montants)</div>`));
    form.appendChild(el(`<div class="row2">
      <label>Longueur de cloison (ml)<input id="pc-long" type="number" min="0" step="0.1" value="${esc(st.longueur)}" placeholder="Ex : 8"></label>
      <label>Hauteur (m)<input id="pc-haut" type="number" min="0" step="0.05" value="${esc(st.hauteur)}" placeholder="Ex : 2,5"></label>
    </div>`));
    form.appendChild(el(`<label>Entraxe des montants<select id="pc-entraxe">
      <option value="0.6">60 cm (courant)</option>
      <option value="0.4">40 cm (renforce, carrelage)</option>
    </select></label>`));
    cont.appendChild(form);
    const res = el(`<div class="ec-res" id="pc-res"></div>`);
    cont.appendChild(res);

    const q = (s) => form.querySelector(s);
    q("#pc-surf").addEventListener("input", (e) => { st.surface = e.target.value; recalc(); });
    q("#pc-format").addEventListener("change", (e) => { st.format = e.target.value; recalc(); });
    q("#pc-chutes").addEventListener("input", (e) => { st.chutes = e.target.value; recalc(); });
    const ouvrage = q("#pc-ouvrage"); ouvrage.value = st.ouvrage;
    ouvrage.addEventListener("change", (e) => { st.ouvrage = e.target.value; recalc(); });
    q("#pc-long").addEventListener("input", (e) => { st.longueur = e.target.value; recalc(); });
    q("#pc-haut").addEventListener("input", (e) => { st.hauteur = e.target.value; recalc(); });
    const entraxe = q("#pc-entraxe"); entraxe.value = st.entraxe;
    entraxe.addEventListener("change", (e) => { st.entraxe = e.target.value; recalc(); });

    function recalc() {
      const surf = parseFloat(st.surface) || 0;
      if (!surf) { res.innerHTML = `<div class="ec-res-t">Resultat</div><p class="ec-res-note">Saisissez la surface a couvrir pour lancer le calcul.</p>`; return; }
      const fmt = FORMATS_PLAQUE.find((f) => f.cle === st.format) || FORMATS_PLAQUE[0];
      const chutes = (parseFloat(st.chutes) || 0) / 100;
      // Cloison = 2 faces a plaquer
      const faces = st.ouvrage === "cloison" ? 2 : 1;
      const surfPlaques = surf * faces * (1 + chutes);
      const plaques = Math.ceil(surfPlaques / fmt.surf);
      // Consommables lies a la surface plaquee
      const surfJoint = surf * faces;
      const vis = Math.ceil(surfJoint * (st.ouvrage === "plafond" ? 34 : 29)); // densite indicative
      const visBoites = Math.ceil(vis / 1000);
      const bandeMl = Math.ceil(surfJoint * 2.0); // ~2 ml de bande par m²
      const bandeRlx = Math.ceil(bandeMl / 150); // rouleau de 150 m
      const enduitKg = surfJoint * 0.5; // ~0,5 kg/m² pour les joints
      const enduitSacs = Math.ceil(enduitKg / 25); // sac de 25 kg
      // Ossature si longueur + hauteur renseignees
      const L = parseFloat(st.longueur) || 0, H = parseFloat(st.hauteur) || 0, ent = parseFloat(st.entraxe) || 0.6;
      let ossHtml = "";
      if (L > 0 && H > 0) {
        const railsMl = Math.ceil(2 * L * (1 + chutes)); // haut + bas
        const nbMontants = Math.ceil(L / ent) + 1;
        const montantsMl = Math.ceil(nbMontants * H * (1 + chutes));
        ossHtml = `
          <div class="ec-res-row"><span>Rails (haut + bas)</span><b>${railsMl} ml</b></div>
          <div class="ec-res-row"><span>Montants (entraxe ${ent === 0.4 ? "40" : "60"} cm)</span><b>${nbMontants} u. - ${montantsMl} ml</b></div>`;
      }
      res.innerHTML = `
        <div class="ec-res-t">Resultat</div>
        <div class="ec-res-main"><span>Plaques de platre (${fmt.label.split(" (")[0]})</span><strong>${plaques} plaques</strong></div>
        <div class="ec-res-row"><span>Surface plaquee (${faces === 2 ? "2 faces" : "1 face"}, + ${st.chutes || 0}%)</span><b>${num(surfPlaques, 1)} m²</b></div>
        ${ossHtml}
        <div class="ec-res-row"><span>Vis a placo</span><b>~ ${vis} u. (${visBoites} boite${visBoites > 1 ? "s" : ""} de 1000)</b></div>
        <div class="ec-res-row"><span>Bande a joint</span><b>~ ${bandeMl} ml (${bandeRlx} rouleau${bandeRlx > 1 ? "x" : ""} de 150 m)</b></div>
        <div class="ec-res-row"><span>Enduit a joint</span><b>~ ${num(enduitKg, 1)} kg (${enduitSacs} sac${enduitSacs > 1 ? "s" : ""} de 25 kg)</b></div>
        <p class="ec-res-note">Quantites indicatives. L'ossature n'est calculee que si vous renseignez la longueur et la hauteur de cloison.</p>`;
    }
    recalc();
    return cont;
  }

  // ----- 3. Enduit / ratissage -----
  const TYPES_ENDUIT = [
    { cle: "lissage", label: "Ratissage / lissage fin", kgm2: 1.0 },
    { cle: "garnissant", label: "Enduit garnissant", kgm2: 1.5 },
    { cle: "rebouchage", label: "Rebouchage / degrossissage", kgm2: 2.0 },
  ];
  function sectionCalcEnduit() {
    const st = sectionCalcEnduit._st || (sectionCalcEnduit._st = {
      surface: "", type: "lissage", passes: "2", sac: "25",
    });
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Enduit / ratissage", "Kilos d'enduit et nombre de sacs", "calc"));

    const form = el(`<div class="ec-form"></div>`);
    const labSurf = el(`<label>Surface a enduire (m²)<input id="en-surf" type="number" min="0" step="0.5" value="${esc(st.surface)}" placeholder="Ex : 30"></label>`);
    form.appendChild(labSurf);
    const rep = blocReport(labSurf.querySelector("input"));
    if (rep) form.appendChild(rep);
    form.appendChild(el(`<label>Type d'enduit<select id="en-type">
      ${TYPES_ENDUIT.map((t) => `<option value="${t.cle}" ${t.cle === st.type ? "selected" : ""}>${t.label} (~${num(t.kgm2, 1)} kg/m²/passe)</option>`).join("")}
    </select></label>`));
    form.appendChild(el(`<div class="row2">
      <label>Nombre de passes<input id="en-passes" type="number" min="1" step="1" value="${esc(st.passes)}"></label>
      <label>Conditionnement<select id="en-sac">
        <option value="25">Sac de 25 kg</option>
        <option value="15">Sac de 15 kg</option>
        <option value="5">Sac / seau de 5 kg</option>
      </select></label>
    </div>`));
    cont.appendChild(form);
    const res = el(`<div class="ec-res" id="en-res"></div>`);
    cont.appendChild(res);

    const q = (s) => form.querySelector(s);
    q("#en-surf").addEventListener("input", (e) => { st.surface = e.target.value; recalc(); });
    const ty = q("#en-type"); ty.value = st.type;
    ty.addEventListener("change", (e) => { st.type = e.target.value; recalc(); });
    q("#en-passes").addEventListener("input", (e) => { st.passes = e.target.value; recalc(); });
    const sac = q("#en-sac"); sac.value = st.sac;
    sac.addEventListener("change", (e) => { st.sac = e.target.value; recalc(); });

    function recalc() {
      const surf = parseFloat(st.surface) || 0;
      if (!surf) { res.innerHTML = `<div class="ec-res-t">Resultat</div><p class="ec-res-note">Saisissez la surface a enduire pour lancer le calcul.</p>`; return; }
      const t = TYPES_ENDUIT.find((x) => x.cle === st.type) || TYPES_ENDUIT[0];
      const passes = Math.max(1, parseInt(st.passes) || 1);
      const tailleSac = parseFloat(st.sac) || 25;
      const kg = surf * t.kgm2 * passes;
      const kgMarge = kg * 1.1;
      const sacs = Math.ceil(kgMarge / tailleSac);
      res.innerHTML = `
        <div class="ec-res-t">Resultat</div>
        <div class="ec-res-row"><span>Consommation (${passes} passe${passes > 1 ? "s" : ""})</span><b>${num(kg, 1)} kg</b></div>
        <div class="ec-res-row"><span>Avec marge +10 %</span><b>${num(kgMarge, 1)} kg</b></div>
        <div class="ec-res-main"><span>Sacs de ${tailleSac} kg</span><strong>${sacs} sac${sacs > 1 ? "s" : ""}</strong></div>
        <p class="ec-res-note">Rendement indicatif (${num(t.kgm2, 1)} kg/m² par passe). Il varie selon l'epaisseur appliquee et l'etat du support.</p>`;
    }
    recalc();
    return cont;
  }

  // ----- 4. Peinture -----
  const TYPES_PEINTURE = [
    { cle: "mur", label: "Peinture murs (acrylique)", rend: 10 },
    { cle: "plafond", label: "Peinture plafond", rend: 9 },
    { cle: "boiserie", label: "Boiseries / laque", rend: 12 },
    { cle: "souscouche", label: "Sous-couche d'impression", rend: 8 },
    { cle: "facade", label: "Peinture facade", rend: 6 },
  ];
  function sectionCalcPeinture() {
    const st = sectionCalcPeinture._st || (sectionCalcPeinture._st = {
      surface: "", type: "mur", rend: "10", couches: "2", marge: "5", pot: "10", prix: "",
    });
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Peinture", "Litres, pots et cout matiere", "calc"));

    const form = el(`<div class="ec-form"></div>`);
    const labSurf = el(`<label>Surface a peindre (m²)<input id="pe-surf" type="number" min="0" step="0.5" value="${esc(st.surface)}" placeholder="Ex : 35"></label>`);
    form.appendChild(labSurf);
    const rep = blocReport(labSurf.querySelector("input"));
    if (rep) form.appendChild(rep);
    form.appendChild(el(`<label>Type de produit<select id="pe-type">
      ${TYPES_PEINTURE.map((t) => `<option value="${t.cle}" ${t.cle === st.type ? "selected" : ""}>${t.label} (~${t.rend} m²/L)</option>`).join("")}
    </select></label>`));
    form.appendChild(el(`<div class="row2">
      <label>Rendement (m²/L)<input id="pe-rend" type="number" min="1" step="0.5" value="${esc(st.rend)}"></label>
      <label>Nombre de couches<input id="pe-couches" type="number" min="1" step="1" value="${esc(st.couches)}"></label>
    </div>`));
    form.appendChild(el(`<div class="row2">
      <label>Marge de securite (%)<input id="pe-marge" type="number" min="0" step="1" value="${esc(st.marge)}"></label>
      <label>Conditionnement<select id="pe-pot">
        <option value="10">Pot de 10 L</option>
        <option value="5">Pot de 5 L</option>
        <option value="2.5">Pot de 2,5 L</option>
      </select></label>
    </div>`));
    form.appendChild(el(`<label>Prix du produit (€ / litre, optionnel)<input id="pe-prix" type="number" min="0" step="0.5" value="${esc(st.prix)}" placeholder="Pour estimer le cout matiere"></label>`));
    cont.appendChild(form);
    const res = el(`<div class="ec-res" id="pe-res"></div>`);
    cont.appendChild(res);

    const q = (s) => form.querySelector(s);
    q("#pe-surf").addEventListener("input", (e) => { st.surface = e.target.value; recalc(); });
    const ty = q("#pe-type"); ty.value = st.type;
    ty.addEventListener("change", (e) => {
      st.type = e.target.value;
      const t = TYPES_PEINTURE.find((x) => x.cle === st.type);
      if (t) { st.rend = String(t.rend); q("#pe-rend").value = t.rend; }
      recalc();
    });
    q("#pe-rend").addEventListener("input", (e) => { st.rend = e.target.value; recalc(); });
    q("#pe-couches").addEventListener("input", (e) => { st.couches = e.target.value; recalc(); });
    q("#pe-marge").addEventListener("input", (e) => { st.marge = e.target.value; recalc(); });
    const pot = q("#pe-pot"); pot.value = st.pot;
    pot.addEventListener("change", (e) => { st.pot = e.target.value; recalc(); });
    q("#pe-prix").addEventListener("input", (e) => { st.prix = e.target.value; recalc(); });

    function recalc() {
      const surf = parseFloat(st.surface) || 0;
      const rend = parseFloat(st.rend) || 0;
      if (!surf || !rend) { res.innerHTML = `<div class="ec-res-t">Resultat</div><p class="ec-res-note">Saisissez la surface et le rendement pour lancer le calcul.</p>`; return; }
      const couches = Math.max(1, parseInt(st.couches) || 1);
      const marge = (parseFloat(st.marge) || 0) / 100;
      const litres = surf * couches / rend;
      const litresMarge = litres * (1 + marge);
      const tPot = parseFloat(st.pot) || 10;
      const pots = Math.ceil(litresMarge / tPot);
      const prix = parseFloat(st.prix) || 0;
      const coutHtml = prix ? `<div class="ec-res-row"><span>Cout matiere (${num(litresMarge, 1)} L x ${euro(prix)})</span><b>${euro(litresMarge * prix)}</b></div>` : "";
      res.innerHTML = `
        <div class="ec-res-t">Resultat</div>
        <div class="ec-res-row"><span>Peinture (${couches} couche${couches > 1 ? "s" : ""})</span><b>${num(litres, 1)} L</b></div>
        <div class="ec-res-row"><span>Avec marge +${st.marge || 0} %</span><b>${num(litresMarge, 1)} L</b></div>
        <div class="ec-res-main"><span>Pots de ${num(tPot, 1)} L</span><strong>${pots} pot${pots > 1 ? "s" : ""}</strong></div>
        ${coutHtml}
        <p class="ec-res-note">Rendement pour ${num(rend, 1)} m²/L. La 1re couche sur support neuf ou poreux consomme davantage : prevoir une sous-couche.</p>`;
    }
    recalc();
    return cont;
  }

  // ----- 5. Tapisserie / revetements -----
  function sectionCalcTapisserie() {
    const st = sectionCalcTapisserie._st || (sectionCalcTapisserie._st = {
      mode: "papier", surface: "", hauteur: "2.5", raccord: "0",
      rlxLong: "10.05", rlxLarg: "0.53", tdvLong: "25", tdvLarg: "1",
    });
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Tapisserie / revetements", "Rouleaux et colle", "calc"));

    const form = el(`<div class="ec-form"></div>`);
    form.appendChild(el(`<div class="ec-seg">
      <button class="ec-seg-b ${st.mode === "papier" ? "on" : ""}" data-m="papier">Papier peint</button>
      <button class="ec-seg-b ${st.mode === "tdv" ? "on" : ""}" data-m="tdv">Toile de verre</button>
    </div>`));
    const labSurf = el(`<label>Surface des murs (m²)<input id="ta-surf" type="number" min="0" step="0.5" value="${esc(st.surface)}" placeholder="Ex : 30"></label>`);
    form.appendChild(labSurf);
    const rep = blocReport(labSurf.querySelector("input"));
    if (rep) form.appendChild(rep);
    const dyn = el(`<div id="ta-dyn"></div>`);
    form.appendChild(dyn);
    cont.appendChild(form);
    const res = el(`<div class="ec-res" id="ta-res"></div>`);
    cont.appendChild(res);

    function peindreDyn() {
      if (st.mode === "papier") {
        dyn.innerHTML = `
          <div class="row2">
            <label>Hauteur des murs (m)<input id="ta-haut" type="number" min="0" step="0.05" value="${esc(st.hauteur)}"></label>
            <label>Raccord du motif (cm)<input id="ta-racc" type="number" min="0" step="1" value="${esc(st.raccord)}" placeholder="0 = sans"></label>
          </div>
          <div class="row2">
            <label>Longueur du rouleau (m)<input id="ta-rl" type="number" min="1" step="0.05" value="${esc(st.rlxLong)}"></label>
            <label>Largeur du rouleau (m)<input id="ta-rw" type="number" min="0.1" step="0.01" value="${esc(st.rlxLarg)}"></label>
          </div>`;
        dyn.querySelector("#ta-haut").addEventListener("input", (e) => { st.hauteur = e.target.value; recalc(); });
        dyn.querySelector("#ta-racc").addEventListener("input", (e) => { st.raccord = e.target.value; recalc(); });
        dyn.querySelector("#ta-rl").addEventListener("input", (e) => { st.rlxLong = e.target.value; recalc(); });
        dyn.querySelector("#ta-rw").addEventListener("input", (e) => { st.rlxLarg = e.target.value; recalc(); });
      } else {
        dyn.innerHTML = `<div class="row2">
            <label>Longueur du rouleau (m)<input id="ta-tl" type="number" min="1" step="1" value="${esc(st.tdvLong)}"></label>
            <label>Largeur du rouleau (m)<input id="ta-tw" type="number" min="0.1" step="0.05" value="${esc(st.tdvLarg)}"></label>
          </div>`;
        dyn.querySelector("#ta-tl").addEventListener("input", (e) => { st.tdvLong = e.target.value; recalc(); });
        dyn.querySelector("#ta-tw").addEventListener("input", (e) => { st.tdvLarg = e.target.value; recalc(); });
      }
    }
    form.querySelectorAll(".ec-seg-b").forEach((b) => b.addEventListener("click", () => {
      st.mode = b.dataset.m;
      form.querySelectorAll(".ec-seg-b").forEach((x) => x.classList.toggle("on", x.dataset.m === st.mode));
      peindreDyn(); recalc();
    }));
    form.querySelector("#ta-surf").addEventListener("input", (e) => { st.surface = e.target.value; recalc(); });
    peindreDyn();

    function recalc() {
      const surf = parseFloat(st.surface) || 0;
      if (!surf) { res.innerHTML = `<div class="ec-res-t">Resultat</div><p class="ec-res-note">Saisissez la surface des murs pour lancer le calcul.</p>`; return; }
      if (st.mode === "papier") {
        const H = parseFloat(st.hauteur) || 0;
        const raccord = (parseFloat(st.raccord) || 0) / 100;
        const rl = parseFloat(st.rlxLong) || 10.05;
        const rw = parseFloat(st.rlxLarg) || 0.53;
        if (!H || !rw) { res.innerHTML = `<div class="ec-res-t">Resultat</div><p class="ec-res-note">Renseignez la hauteur des murs et les dimensions du rouleau.</p>`; return; }
        const perimetre = surf / H; // lineaire de murs
        const nbLes = Math.ceil(perimetre / rw);
        // Longueur d'un le : hauteur + 10 cm de recoupe + perte de raccord
        const longLe = H + 0.10 + raccord;
        const lesParRouleau = Math.max(1, Math.floor(rl / longLe));
        const rouleaux = Math.ceil(nbLes / lesParRouleau);
        const colle = Math.ceil(rouleaux / 6); // 1 paquet de colle ~ 5-6 rouleaux
        res.innerHTML = `
          <div class="ec-res-t">Resultat</div>
          <div class="ec-res-row"><span>Lineaire de murs (surface / hauteur)</span><b>${num(perimetre, 1)} ml</b></div>
          <div class="ec-res-row"><span>Nombre de les (largeur ${num(rw, 2)} m)</span><b>${nbLes} les</b></div>
          <div class="ec-res-row"><span>Les par rouleau${raccord ? " (raccord " + st.raccord + " cm)" : ""}</span><b>${lesParRouleau}</b></div>
          <div class="ec-res-main"><span>Rouleaux de papier peint</span><strong>${rouleaux} rouleaux</strong></div>
          <div class="ec-res-row"><span>Colle</span><b>~ ${colle} paquet${colle > 1 ? "s" : ""}</b></div>
          <p class="ec-res-note">Un raccord de motif augmente la perte par le. Verifiez le raccord indique sur la reference du papier.</p>`;
      } else {
        const tl = parseFloat(st.tdvLong) || 25;
        const tw = parseFloat(st.tdvLarg) || 1;
        const surfRouleau = tl * tw;
        const surfMarge = surf * 1.1; // +10 % de chutes
        const rouleaux = Math.ceil(surfMarge / surfRouleau);
        const colleKg = surf * 0.25; // ~250 g/m²
        const seaux = Math.ceil(colleKg / 5); // seau de 5 kg
        res.innerHTML = `
          <div class="ec-res-t">Resultat</div>
          <div class="ec-res-row"><span>Surface avec chutes (+10 %)</span><b>${num(surfMarge, 1)} m²</b></div>
          <div class="ec-res-row"><span>Surface d'un rouleau (${num(tl, 0)} x ${num(tw, 2)} m)</span><b>${num(surfRouleau, 1)} m²</b></div>
          <div class="ec-res-main"><span>Rouleaux de toile de verre</span><strong>${rouleaux} rouleaux</strong></div>
          <div class="ec-res-row"><span>Colle (~250 g/m²)</span><b>~ ${num(colleKg, 1)} kg (${seaux} seau${seaux > 1 ? "x" : ""} de 5 kg)</b></div>
          <p class="ec-res-note">La toile de verre se peint ensuite : reportez la surface dans le calculateur Peinture.</p>`;
      }
    }
    recalc();
    return cont;
  }

  // =====================================================================
  //  CATALOGUE
  // =====================================================================
  async function sectionCatalogue() {
    const list = await store.catalogue();
    const cont = el(`<div class="page pl-page"></div>`);
    cont.appendChild(enteteSection("Catalogue de prestations", "Vos tarifs peinture et decoration (HT)", "accueil"));
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
    const d = p || { libelle: "", unite: "m2", prixHT: "" };
    const unites = ["m2", "ml", "forfait", "heure", "unite", "jour"];
    const opts = unites.map((u) => `<option value="${u}" ${u === d.unite ? "selected" : ""}>${u}</option>`).join("");
    const sheet = el(`
      <div class="modal">
        <div class="sheet">
          <div class="sheet-head"><h2>${edition ? "Modifier la prestation" : "Nouvelle prestation"}</h2><button class="x" id="close">&times;</button></div>
          <div class="sheet-body">
            <label>Libelle<input id="p-lib" type="text" value="${esc(d.libelle)}" placeholder="Ex : Peinture murs 2 couches"></label>
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
    cont.appendChild(enteteSection("Documents", "Documents prets a imprimer et signer", "accueil"));
    const grid = el(`<div class="pl-cards"></div>`);
    const cInfos = carteNav(I.building, "Infos de mon entreprise", infos && infos.raisonSociale ? esc(infos.raisonSociale) : "A renseigner", () => formInfos());
    if (!infos || !infos.raisonSociale) cInfos.classList.add("warn");
    grid.appendChild(cInfos);
    grid.appendChild(carteNav(I.check, "PV de reception des travaux", "Reception client, reserves, signatures", () => formPV()));
    grid.appendChild(carteNav(I.file, "Attestation TVA 10 %", "Travaux de renovation (logement > 2 ans)", () => formAttestationTVA()));
    cont.appendChild(grid);
    cont.appendChild(el(`<p class="pl-note">Le PV de reception marque le depart des garanties et le solde du chantier. C'est un <b>modele</b> a adapter, il n'a pas de forme reglementaire imposee.</p>`));
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
              <p class="reg-hint">Ces informations apparaissent en en-tete de vos documents. Elles restent sur votre appareil et sont partagees avec vos autres modules metier.</p>
              <label>Raison sociale<input id="i-rs" type="text" value="${esc(d.raisonSociale)}" placeholder="Ex : Peinture Martin"></label>
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

  // ----- PV de reception des travaux -----
  const CONTROLES_PV = [
    "Surfaces peintes uniformes, sans manque ni surepaisseur",
    "Raccords, angles et aretes nets",
    "Absence de coulures, projections et traces",
    "Cloisons et plaques d'aplomb, joints sans fissure",
    "Papier peint / toile sans decollement ni bulle, raccords alignes",
    "Chantier nettoye, protections retirees",
  ];
  function formPV() {
    store.infos().then((infos) => {
      if (!infos || !infos.raisonSociale) { toast("Renseignez d'abord les infos de votre entreprise."); formInfos(); return; }
      const sigEnregistree = !!infos.signatureTech;
      const controlesHtml = CONTROLES_PV.map((c, i) =>
        `<label class="ec-ctrl"><input type="checkbox" id="k-${i}" checked><span>${esc(c)}</span></label>`).join("");
      const sheet = el(`
        <div class="modal">
          <div class="sheet">
            <div class="sheet-head"><h2>PV de reception des travaux</h2><button class="x" id="close">&times;</button></div>
            <div class="sheet-body">
              <p class="reg-hint">Proces-verbal signe par le client a la fin du chantier. Il acte la reception et le depart des garanties.</p>
              <label>Nom du client<input id="k-client" type="text" placeholder="Nom et prenom"></label>
              <label>Adresse du chantier<input id="k-adresse" type="text" placeholder="Adresse des travaux"></label>
              <label>Nature des travaux<textarea id="k-desc" rows="2" placeholder="Ex : ratissage + 2 couches sejour, pose placo couloir, papier peint chambre..."></textarea></label>
              <label>Decision de reception<select id="k-decision">
                <option value="sans">Reception SANS reserve</option>
                <option value="avec">Reception AVEC reserves</option>
                <option value="refus">Reception refusee</option>
              </select></label>
              <div class="ec-ctrl-box">
                <div class="sig-lab">Points verifies</div>
                ${controlesHtml}
              </div>
              <label>Reserves / observations<textarea id="k-obs" rows="2" placeholder="Ex : aucune reserve"></textarea></label>
              <div class="row2">
                <label>Fait a (ville)<input id="k-ville" type="text" placeholder="Ex : Le Creusot"></label>
                <label>Date de reception<input id="k-date" type="date" value="${esc(todayISO())}"></label>
              </div>
              <div class="sig-bloc">
                <div class="sig-lab">Signature du client</div>
                <canvas class="sig-pad" id="sig-k-client"></canvas>
                <div class="sig-actions"><button type="button" class="mini" id="sig-k-client-clear">Effacer</button></div>
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
            <div class="sheet-foot"><span></span><button class="primary" id="gen">Generer le PV</button></div>
          </div>
        </div>`);
      const close = () => sheet.remove();
      sheet.querySelector("#close").addEventListener("click", close);
      sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
      document.getElementById("app").appendChild(sheet);

      const padClient = creerSignaturePad(sheet.querySelector("#sig-k-client"));
      const padEnt = creerSignaturePad(sheet.querySelector("#sig-k-ent"));
      sheet.querySelector("#sig-k-client-clear").addEventListener("click", () => padClient.effacer());
      sheet.querySelector("#sig-k-ent-clear").addEventListener("click", () => padEnt.effacer());

      sheet.querySelector("#gen").addEventListener("click", async () => {
        const client = sheet.querySelector("#k-client").value.trim();
        const adresse = sheet.querySelector("#k-adresse").value.trim();
        if (!client || !adresse) { toast("Renseignez le client et l'adresse du chantier."); return; }
        let sigEnt = padEnt.dataURL();
        if (!sigEnt && infos.signatureTech) sigEnt = infos.signatureTech;
        if (padEnt.dataURL() && sheet.querySelector("#sig-k-ent-save").checked) {
          infos.signatureTech = padEnt.dataURL();
          await store.setInfos(infos);
        }
        const decVal = sheet.querySelector("#k-decision").value;
        const decisions = { sans: "Reception prononcee SANS reserve", avec: "Reception prononcee AVEC reserves", refus: "Reception refusee" };
        const controles = CONTROLES_PV.filter((_, i) => sheet.querySelector("#k-" + i).checked);
        close();
        const data = {
          infos, client, adresse,
          desc: sheet.querySelector("#k-desc").value.trim(),
          decision: decisions[decVal] || decisions.sans,
          decisionCle: decVal,
          controles,
          observations: sheet.querySelector("#k-obs").value.trim(),
          ville: sheet.querySelector("#k-ville").value.trim(),
          dateFR: fmtFR(sheet.querySelector("#k-date").value || todayISO()),
          sigClientSrc: padClient.dataURL(), sigEntSrc: sigEnt,
        };
        const canvas = await construireCanvasPV(data);
        const nom = "PV_reception_" + (client || "client").replace(/[^a-zA-Z0-9]+/g, "_") + ".png";
        apercuImage(canvas, nom, "PV de reception");
      });
    });
  }

  // ----- Attestation TVA taux reduit (brique commune) -----
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
              <label>Nature des travaux<textarea id="t-nature" rows="3" placeholder="Ex : preparation, ratissage et mise en peinture..."></textarea></label>
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

  // Entete entreprise commun aux documents (retourne le y courant)
  function dessineEntete(ctx, data, W, M, draw, yStart) {
    let y = yStart;
    ctx.textBaseline = "top"; ctx.textAlign = "left";
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
    return y;
  }

  // PV de reception des travaux (image)
  async function construireCanvasPV(data) {
    const imgClient = await chargerImg(data.sigClientSrc);
    const imgEnt = await chargerImg(data.sigEntSrc);
    const W = 1240, M = 90, cW = W - M * 2;

    function render(ctx, draw) {
      let y = dessineEntete(ctx, data, W, M, draw, 78);
      // Titre
      ctx.textAlign = "center"; ctx.fillStyle = "#0f1720"; ctx.font = "700 36px Arial";
      if (draw) ctx.fillText("PROCES-VERBAL DE RECEPTION", W / 2, y); y += 46;
      ctx.font = "21px Arial"; ctx.fillStyle = "#55617a";
      if (draw) ctx.fillText("Reception des travaux de peinture et decoration", W / 2, y); y += 40;
      ctx.textAlign = "left";
      // Intro
      ctx.fillStyle = "#1a2230"; ctx.font = "22px Arial";
      wrapTexte(ctx, "Le present proces-verbal constate la reception des travaux realises par l'entreprise " + data.infos.raisonSociale + " pour le client designe ci-dessous.", cW)
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
        ["Adresse du chantier", data.adresse || "-"],
        ["Nature des travaux", data.desc || "-"],
        ["Date de reception", data.dateFR],
      ]);
      // Decision (bandeau)
      y += 14;
      const okDec = data.decisionCle === "sans";
      const refus = data.decisionCle === "refus";
      const bg = refus ? "#fdecec" : okDec ? "#eaf7ef" : "#fef6e7";
      const fg = refus ? "#a52020" : okDec ? "#0f7a3f" : "#8a5a00";
      if (draw) {
        ctx.fillStyle = bg; ctx.fillRect(M, y, cW, 52);
        ctx.strokeStyle = fg; ctx.lineWidth = 1.5; ctx.strokeRect(M, y, cW, 52);
        ctx.fillStyle = fg; ctx.font = "700 24px Arial"; ctx.textAlign = "center";
        ctx.fillText(data.decision, W / 2, y + 14); ctx.textAlign = "left";
      }
      y += 74;
      // Points verifies
      sectionTitre("Points verifies");
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
      // Reserves
      sectionTitre("Reserves / observations");
      ctx.fillStyle = "#1a2230"; ctx.font = "21px Arial";
      wrapTexte(ctx, data.observations || "Aucune reserve.", cW).forEach((l) => { if (draw) ctx.fillText(l, M, y); y += 29; });
      // Mention garanties
      y += 10; ctx.fillStyle = "#55617a"; ctx.font = "20px Arial";
      wrapTexte(ctx, "La reception, avec ou sans reserve, marque le point de depart des garanties legales (parfait achevement, biennale de bon fonctionnement, decennale le cas echeant).", cW)
        .forEach((l) => { if (draw) ctx.fillText(l, M, y); y += 28; });
      // Fait a
      y += 18; ctx.fillStyle = "#1a2230"; ctx.font = "22px Arial";
      if (draw) ctx.fillText("Fait a " + (data.ville || "...................") + ", le " + data.dateFR, M, y);
      y += 44;
      // Signatures client + entreprise
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
      dessineSig(M, "Signature du client (precede de \"recu\")", imgClient);
      dessineSig(M + boxW + 40, "Cachet et signature de l'entreprise", imgEnt);
      y += boxH + 26;
      if (draw) {
        ctx.strokeStyle = "#dde3ee"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
        ctx.fillStyle = "#8892a6"; ctx.font = "17px Arial"; ctx.textAlign = "center";
        ctx.fillText("Modele de proces-verbal de reception. A adapter a votre chantier.", W / 2, y + 12);
        ctx.textAlign = "left";
      }
      y += 44;
      return y;
    }

    const tmp = document.createElement("canvas"); tmp.width = W; tmp.height = 3600;
    const finalY = render(tmp.getContext("2d"), false);
    const H = Math.max(1754, Math.ceil(finalY));
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
    render(ctx, true);
    return cv;
  }

  // Attestation TVA (image) - meme mise en forme que les autres packs
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
  S.peintre = {
    page,
    reset() { estate.section = "accueil"; },
  };
})();
