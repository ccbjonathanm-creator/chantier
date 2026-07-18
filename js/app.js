/*
 * app.js - Interface et logique de navigation de Chantier.
 * Vanilla JS, pas de framework. Rendu par remplacement du #app.
 */
(function () {
  "use strict";

  // Choix du backend : "demo" (local) ou "supabase" (cloud), memorise sur l'appareil.
  const BACKEND_KEY = "chantier_backend";
  function backendChoisi() {
    try { return localStorage.getItem(BACKEND_KEY) || "demo"; } catch (e) { return "demo"; }
  }
  const backends = window.Chantier.backends || {};
  window.Chantier.api = backends[backendChoisi()] || backends.demo;
  const api = window.Chantier.api;
  const { todayISO } = window.Chantier.util;
  const app = document.getElementById("app");

  // Mode LECTURE SEULE : abonnement ferme (essai expire, past_due, impaye,
  // resilie hors periode payee). La consultation des donnees reste possible,
  // mais toute ECRITURE est neutralisee ici, EN PLUS du blocage serveur (RLS),
  // avec un message clair invitant a s'abonner. Le serveur reste la verite.
  function enLectureSeule() { return !!state.lectureSeule; }
  (function protegerEcritures() {
    const METHODES = ["createIntervention", "updateIntervention", "deleteIntervention",
      "setStatut", "demarrerPointage", "terminerPointage", "ajouterNote", "supprimerNote"];
    METHODES.forEach((m) => {
      if (!api || typeof api[m] !== "function") return;
      const orig = api[m].bind(api);
      api[m] = function () {
        if (enLectureSeule()) {
          montrerToast("Periode d'essai terminee. Abonnez-vous pour creer ou modifier.", "attente");
          return Promise.reject(new Error("lecture-seule"));
        }
        return orig.apply(api, arguments);
      };
    });
  })();

  // ---------- Modules payants (fonctions optionnelles, achat unique) ----------
  // Catalogue presente au patron. Une future fonction payante s'ajoute ici,
  // puis se protege dans le code avec features.actif("<cle>").
  const MODULES_CATALOGUE = {
    plombier: { libelle: "Pack Plomberie / Chauffage", prix: "20 €", desc: "Contrats d'entretien avec rappels, catalogue de prestations, attestations d'entretien et TVA 10 %." },
    electricien: { libelle: "Pack Electricien", prix: "20 €", desc: "Calculateurs NF C 15-100 (bilan de puissance, section de cable, chute de tension), catalogue de prestations, attestation de conformite et TVA." },
    peintre: { libelle: "Pack Peintre en batiment", prix: "20 €", desc: "Calculateurs de metre (placo, enduit, peinture, tapisserie), catalogue de prestations, PV de reception des travaux et attestation TVA." },
  };
  // Modules metier qui apportent un onglet "Metier" (ordre d'affichage).
  const METIER_MODULES = ["plombier", "electricien", "peintre"];
  // Renvoie la cle du 1er module metier debloque ET charge (ou null).
  function metierActif() {
    for (const cle of METIER_MODULES) {
      if (features.actif(cle) && window.Chantier[cle] && window.Chantier[cle].page) return cle;
    }
    return null;
  }
  // Couche de detection : "cette fonction est-elle debloquee pour l'entreprise ?"
  window.Chantier.features = {
    _actifs: [],
    charger(liste) { this._actifs = Array.isArray(liste) ? liste : []; },
    actif(cle) { return this._actifs.indexOf(cle) !== -1; },
    liste() { return this._actifs.slice(); },
  };
  const features = window.Chantier.features;

  const state = {
    me: null, // employe connecte (patron ou employe)
    onglet: "planning", // patron: planning | equipe ; employe: tournee
    date: todayISO(),
    vue: "jour", // jour | mois | annee (niveau de zoom de l'agenda)
    lectureSeule: false, // vrai si abonnement ferme : consultation only
  };

  // ---------- Helpers ----------
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
  function fmtDateFR(iso) {
    const [y, m, d] = iso.split("-");
    const jours = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
    const dt = new Date(+y, +m - 1, +d);
    const mois = ["janv", "fevr", "mars", "avr", "mai", "juin", "juil", "aout", "sept", "oct", "nov", "dec"];
    return jours[dt.getDay()] + ". " + (+d) + " " + mois[+m - 1];
  }
  function dureeStr(ms) {
    const min = Math.round(ms / 60000);
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h <= 0) return m + " min";
    return h + "h" + String(m).padStart(2, "0");
  }
  function joursEntre(d1, d2) {
    const a = new Date(d1 + "T00:00:00").getTime();
    const b = new Date(d2 + "T00:00:00").getTime();
    return Math.round((b - a) / 86400000) + 1;
  }
  function estLong(it) {
    return (it.dateFin || it.date) > it.date;
  }
  function chipChantier(it) {
    if (!estLong(it)) return "";
    const total = joursEntre(it.date, it.dateFin);
    const jourEnCours = state.date >= it.date && state.date <= it.dateFin
      ? joursEntre(it.date, state.date) : 0;
    const num = jourEnCours ? `Jour ${jourEnCours}/${total}` : `${total} jours`;
    return `<span class="chip-long">🔧 Chantier ${esc(num)}</span>`;
  }

  // --- Dates : mois et annee ---
  const MOIS_FR = ["Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin", "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre"];
  const MOIS_COURT = ["Janv", "Fevr", "Mars", "Avr", "Mai", "Juin", "Juil", "Aout", "Sept", "Oct", "Nov", "Dec"];
  function ymd(y, m, d) {
    return y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }
  function moisLabel(iso) {
    const [y, m] = iso.split("-").map(Number);
    return MOIS_FR[m - 1] + " " + y;
  }
  function anneeOf(iso) { return iso.split("-")[0]; }
  function premierDuMois(iso) {
    const [y, m] = iso.split("-").map(Number);
    return ymd(y, m - 1, 1);
  }
  function dernierDuMois(iso) {
    const [y, m] = iso.split("-").map(Number);
    return ymd(y, m - 1, new Date(y, m, 0).getDate());
  }
  function decalMois(iso, n) {
    const [y, m] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1 + n, 1);
    return ymd(dt.getFullYear(), dt.getMonth(), 1);
  }
  function decalAnnee(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    return ymd(y + n, m - 1, Math.min(d, 28));
  }
  // Lundi = 0 ... Dimanche = 6
  function jourSemaineLundi(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return (new Date(y, m - 1, d).getDay() + 6) % 7;
  }
  let employesCache = [];
  function nomEmploye(id) {
    const e = employesCache.find((x) => x.id === id);
    return e ? e.nom : "?";
  }
  function couleurEmploye(id) {
    const e = employesCache.find((x) => x.id === id);
    return e ? e.couleur : "#64748b";
  }

  const ICON = {
    planning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    equipe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    tournee: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 20l-6-3V4l6 3 6-3 6 3v13l-6-3-6 3zM9 7v13M15 4v13"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
    metier: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.3l-6 6a1.5 1.5 0 0 0 2.1 2.1l6-6a4 4 0 0 0 5.3-5.4l-2.4 2.4-2.1-.6-.6-2.1z"/></svg>',
  };
  // Primitives partagees avec les modules metier (ex : js/plombier.js)
  window.Chantier.shared = { ICON, esc };

  // ---------- Ecran de connexion (dispatch demo / cloud) ----------
  async function renderLogin() {
    if (api.estCloud) return renderLoginCloud();
    return renderLoginDemo();
  }

  // ---------- Connexion CLOUD (email + mot de passe, Supabase) ----------
  async function renderLoginCloud() {
    let mode = "connexion"; // connexion | creer | rejoindre
    app.innerHTML = "";

    function champ(id, label, type, ph) {
      return `<label>${label}<input id="${id}" type="${type}" placeholder="${ph || ""}" autocomplete="off"></label>`;
    }

    function corps() {
      if (mode === "creer") {
        return `
          ${champ("f-ent", "Nom de l'entreprise", "text", "Plomberie Martin")}
          ${champ("f-nom", "Votre nom", "text", "Jean Martin")}
          ${champ("f-email", "Email", "email", "vous@exemple.fr")}
          ${champ("f-pass", "Mot de passe", "password", "6 caracteres minimum")}
          <button class="primary block" id="go">Creer mon entreprise</button>`;
      }
      if (mode === "rejoindre") {
        return `
          ${champ("f-code", "Code de l'entreprise", "text", "Donne par votre patron")}
          ${champ("f-nom", "Votre nom", "text", "Karim B.")}
          ${champ("f-email", "Email", "email", "vous@exemple.fr")}
          ${champ("f-pass", "Mot de passe", "password", "6 caracteres minimum")}
          <button class="primary block" id="go">Rejoindre l'equipe</button>`;
      }
      return `
        ${champ("f-email", "Email", "email", "vous@exemple.fr")}
        ${champ("f-pass", "Mot de passe", "password", "")}
        <button class="primary block" id="go">Se connecter</button>`;
    }

    function dessiner() {
      const wrap = el(`
        <div class="login">
          <div class="brand">
            <div class="logo">${logoSVG()}</div>
            <h1>ClicChantier</h1>
            <p class="tag">Le planning et les heures de votre equipe, sur le terrain.</p>
          </div>
          <div class="login-card">
            <div class="seg">
              <button data-m="connexion" class="${mode === "connexion" ? "on" : ""}">Se connecter</button>
              <button data-m="creer" class="${mode === "creer" ? "on" : ""}">Nouvelle entreprise</button>
              <button data-m="rejoindre" class="${mode === "rejoindre" ? "on" : ""}">Rejoindre</button>
            </div>
            <div class="login-form">${corps()}</div>
            <div class="ia-note" id="err"></div>
          </div>
          <p class="foot">Vos donnees sont synchronisees et protegees par entreprise.</p>
        </div>
      `);
      wrap.querySelectorAll(".seg button").forEach((b) => {
        b.addEventListener("click", () => { mode = b.dataset.m; dessiner(); });
      });
      const err = wrap.querySelector("#err");
      const go = wrap.querySelector("#go");
      const val = (id) => { const n = wrap.querySelector("#" + id); return n ? n.value.trim() : ""; };

      go.addEventListener("click", async () => {
        err.textContent = "";
        const email = val("f-email");
        const pass = wrap.querySelector("#f-pass") ? wrap.querySelector("#f-pass").value : "";
        try {
          go.disabled = true; go.textContent = "Un instant...";
          let prof;
          if (mode === "creer") {
            if (!val("f-ent")) throw new Error("Indiquez le nom de l'entreprise.");
            if (!email || pass.length < 6) throw new Error("Email et mot de passe (6 car. min) requis.");
            prof = await api.signUpPatron(email, pass, val("f-ent"), val("f-nom"));
          } else if (mode === "rejoindre") {
            if (!val("f-code")) throw new Error("Indiquez le code de l'entreprise.");
            if (!email || pass.length < 6) throw new Error("Email et mot de passe (6 car. min) requis.");
            prof = await api.signUpEmploye(email, pass, val("f-code"), val("f-nom"));
          } else {
            prof = await api.signIn(email, pass);
          }
          if (!prof) throw new Error("Profil introuvable.");
          state.me = prof;
          state.onglet = prof.role === "patron" ? "planning" : "tournee";
          employesCache = await api.listEmployes();
          render();
        } catch (e) {
          const msg = String(e && e.message || e);
          err.textContent = msg === "no-profile"
            ? "Ce compte n'est rattache a aucune entreprise. Utilisez \"Rejoindre\" avec un code, ou creez une entreprise."
            : msg;
          go.disabled = false;
          go.textContent = mode === "creer" ? "Creer mon entreprise" : mode === "rejoindre" ? "Rejoindre l'equipe" : "Se connecter";
        }
      });
      app.innerHTML = "";
      app.appendChild(wrap);
    }
    dessiner();
  }

  // ---------- Connexion DEMO (on choisit qui on est) ----------
  async function renderLoginDemo() {
    const employes = await api.listEmployes();
    employesCache = employes;
    app.innerHTML = "";
    const wrap = el(`
      <div class="login">
        <div class="brand">
          <div class="logo">${logoSVG()}</div>
          <h1>ClicChantier</h1>
          <p class="tag">Le planning et les heures de votre equipe, sur le terrain.</p>
        </div>
        <div class="login-card">
          <p class="login-hint">Mode demonstration. Choisissez un profil pour tester :</p>
          <div class="profils"></div>
          <button class="ghost-btn" id="reset-demo">Reinitialiser la demo</button>
        </div>
        <p class="foot">Version demo locale. La synchro cloud entre patron et employes sera branchee ensuite.</p>
      </div>
    `);
    const list = wrap.querySelector(".profils");
    employes.forEach((e) => {
      const b = el(`
        <button class="profil" data-id="${e.id}">
          <span class="avatar" style="background:${e.couleur}">${esc(initiales(e.nom))}</span>
          <span class="profil-txt">
            <span class="profil-nom">${esc(e.nom)}</span>
            <span class="profil-role">${e.role === "patron" ? "Patron / gerant" : "Plombier"}</span>
          </span>
          <span class="chev">&rsaquo;</span>
        </button>
      `);
      b.addEventListener("click", () => {
        api.setSession(e.id);
        state.me = e;
        state.onglet = e.role === "patron" ? "planning" : "tournee";
        render();
      });
      list.appendChild(b);
    });
    wrap.querySelector("#reset-demo").addEventListener("click", async () => {
      await api.resetDemo();
      renderLogin();
    });
    app.appendChild(wrap);
  }

  function initiales(nom) {
    return nom.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  }
  function logoSVG() {
    return '<svg viewBox="0 0 48 48" fill="none"><rect x="4" y="4" width="40" height="40" rx="11" fill="#0e1a2e" stroke="#1e3a5f"/><path d="M16 30c0-5 4-9 9-9m0 0c2.5 0 4.5 2 4.5 4.5S27.5 30 25 30m0-9V14" stroke="#38bdf8" stroke-width="2.6" stroke-linecap="round"/><circle cx="32" cy="17" r="2.6" fill="#f59e0b"/></svg>';
  }

  // ---------- Coquille (barre du haut + navigation du bas) ----------
  function shell(contenu, actions) {
    app.innerHTML = "";
    const patron = state.me.role === "patron";
    const nav = patron
      ? [ ["planning", "Planning", ICON.planning], ["equipe", "Equipe", ICON.equipe] ]
      : [ ["tournee", "Ma tournee", ICON.tournee] ];
    // Onglet du module metier (visible seulement s'il est debloque pour l'entreprise)
    if (patron && metierActif()) nav.push(["metier", "Metier", ICON.metier]);
    const root = el(`
      <div class="screen">
        <header class="topbar">
          <div class="me">
            <span class="avatar sm" style="background:${state.me.couleur}">${esc(initiales(state.me.nom))}</span>
            <div class="me-txt">
              <span class="me-nom">${esc(state.me.nom)}</span>
              <span class="me-role">${patron ? "Patron" : "Plombier"}</span>
            </div>
          </div>
          <div class="top-actions">
            <button class="icon-btn" id="reglages" title="Reglages">${ICON.gear}</button>
            <button class="logout" id="logout">Changer</button>
          </div>
        </header>
        <main class="content"></main>
        <nav class="tabbar"></nav>
      </div>
    `);
    const contentEl = root.querySelector(".content");
    // Bandeau d'essai (cloud) : compteur de jours + alertes J-7 / J-3 / J-1.
    if (api.estCloud && window.Chantier.abonnement && api.facturation) {
      try {
        const bh = window.Chantier.abonnement.banniere(api.facturation());
        if (bh) { const b = el(bh); if (b) contentEl.appendChild(b); }
      } catch (e) {}
    }
    // Bandeau LECTURE SEULE (abonnement ferme) : message clair + bouton abonnement.
    if (api.estCloud && enLectureSeule()) {
      const fact = api.facturation ? api.facturation() : null;
      const eff = fact && (fact.statutEffectif || fact.statut);
      const msg = eff === "trial_expired" ? "Votre periode d'essai est terminee."
        : eff === "canceled" ? "Votre abonnement est resilie."
        : eff === "unpaid" ? "Votre abonnement est impaye."
        : "Un paiement n'a pas abouti.";
      const bar = el('<div role="alert" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center;background:#7c2d12;color:#fff;padding:10px 14px;border-radius:12px;margin:8px 0;font-size:13.5px;line-height:1.4;"></div>');
      const txt = el("<span></span>");
      txt.textContent = msg + " Vos donnees restent consultables en lecture seule.";
      bar.appendChild(txt);
      if (patron) {
        const cta = el('<button style="background:#fff;color:#7c2d12;border:0;border-radius:9px;padding:8px 14px;font-weight:700;cursor:pointer;font-size:13.5px;">Choisir un abonnement</button>');
        cta.addEventListener("click", ouvrirAbonnementModal);
        bar.appendChild(cta);
      } else {
        const info = el("<span></span>");
        info.textContent = "Prevenez le patron pour reactiver l'acces.";
        bar.appendChild(info);
      }
      contentEl.appendChild(bar);
    }
    contentEl.appendChild(contenu);
    const tabbar = root.querySelector(".tabbar");
    nav.forEach(([id, label, icon]) => {
      const t = el(`<button class="tab ${state.onglet === id ? "on" : ""}" data-tab="${id}">${icon}<span>${label}</span></button>`);
      t.addEventListener("click", () => { state.onglet = id; render(); });
      tabbar.appendChild(t);
    });
    root.querySelector("#logout").addEventListener("click", () => {
      arreterSync();
      api.setSession(null);
      state.me = null;
      renderLogin();
    });
    root.querySelector("#reglages").addEventListener("click", sheetReglages);
    app.appendChild(root);
  }

  // ---------- Reglages : cle IA (Groq) ----------
  function sheetReglages() {
    const ia = window.Chantier.ia;
    const sheet = el(`
      <div class="modal">
        <div class="sheet">
          <div class="sheet-head"><h2>Reglages</h2><button class="x" id="close">&times;</button></div>
          <div class="sheet-body">
            <div class="reg-bloc">
              <div class="reg-titre">${ICON.spark} Assistant vocal IA</div>
              <p class="reg-txt">Pour transformer les notes vocales de chantier en comptes-rendus propres, collez votre cle Groq (gratuite). Elle reste sur cet appareil, jamais envoyee ailleurs.</p>
              <label>Cle Groq<input id="f-key" type="password" placeholder="gsk_..." value="${esc(ia.getKey())}"></label>
              <p class="reg-hint">Cle gratuite sur console.groq.com (rubrique API Keys). Sans cle, la dictee marche quand meme, mais sans reformulation IA.</p>
            </div>
            <div class="reg-bloc" id="reg-cloud"></div>
            <div class="reg-bloc" id="reg-modules"></div>
          </div>
          <div class="sheet-foot">
            <button class="danger" id="clear">Effacer</button>
            <button class="primary" id="save">Enregistrer</button>
          </div>
        </div>
      </div>
    `);
    let modulesChanged = false;
    const close = () => { sheet.remove(); if (modulesChanged) render(); };
    sheet.querySelector("#close").addEventListener("click", close);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
    sheet.querySelector("#save").addEventListener("click", () => { ia.setKey(sheet.querySelector("#f-key").value); close(); });
    sheet.querySelector("#clear").addEventListener("click", () => { ia.setKey(""); close(); });

    // Bloc Cloud / synchronisation
    const blocCloud = sheet.querySelector("#reg-cloud");
    const cloud = api.estCloud;
    const info = (cloud && api.infoEntreprise) ? api.infoEntreprise() : null;
    const codeHtml = (cloud && state.me && state.me.role === "patron" && info && info.code)
      ? `<div class="code-box"><span class="code-lab">Code d'invitation (a donner aux employes)</span><span class="code-val">${esc(info.code)}</span></div>`
      : "";
    blocCloud.innerHTML = `
      <div class="reg-titre">${ICON.equipe} Synchronisation</div>
      <p class="reg-txt">Mode actuel : <b>${cloud ? "Cloud (equipe synchronisee)" : "Demonstration (local, sur cet appareil)"}</b>.</p>
      ${codeHtml}
      <button class="ghost-btn" id="switch-backend">${cloud ? "Repasser en mode demonstration" : "Activer le mode Cloud (equipe)"}</button>
      <p class="reg-hint">Le mode Cloud relie le patron et les employes en temps reel via des comptes. Le mode demonstration reste local sur l'appareil, sans compte.</p>`;
    blocCloud.querySelector("#switch-backend").addEventListener("click", () => {
      try { localStorage.setItem(BACKEND_KEY, cloud ? "demo" : "supabase"); } catch (e) {}
      location.reload();
    });

    // Bloc Modules (fonctions optionnelles) : visible pour le patron
    const blocMod = sheet.querySelector("#reg-modules");
    if (state.me && state.me.role === "patron") {
      const demo = !api.estCloud;
      const peindreModules = () => {
        features.charger(api.modulesActifs ? api.modulesActifs() : []); // etat a jour
        const fact = api.facturation ? api.facturation() : null;
        const cles = Object.keys(MODULES_CATALOGUE);
        const lignes = cles.map((cle) => {
          const m = MODULES_CATALOGUE[cle];
          const actif = features.actif(cle);
          return `
            <div class="mod-row ${actif ? "on" : ""} ${demo ? "demo" : ""}" ${demo ? `data-mod="${cle}"` : ""}>
              <div class="mod-txt">
                <span class="mod-nom">${esc(m.libelle)}</span>
                <span class="mod-desc">${esc(m.desc)}</span>
              </div>
              <div class="mod-etat">${actif
                ? '<span class="mod-badge ok">Actif</span>'
                : `<span class="mod-prix">${esc(m.prix)}</span><span class="mod-badge lock">A debloquer</span>`}</div>
            </div>`;
        }).join("");
        const abo = fact
          ? (fact.actif ? `<span class="mod-badge ok">Actif</span>${fact.jusqu ? ` <span class="mod-desc">jusqu'au ${esc(fact.jusqu)}</span>` : ""}`
                        : '<span class="mod-badge lock">Inactif</span>')
          : '<span class="mod-desc">geree hors ligne</span>';
        const aide = demo
          ? '<p class="reg-hint">Mode demonstration : touchez un module pour l\'activer / desactiver et tester.</p>'
          : '<p class="reg-hint">Les modules sont des fonctions en plus, a l\'unite. Pour en activer un, contactez-nous : l\'activation se fait de notre cote (elle ne peut pas se faire depuis l\'appli).</p>';
        // En cloud, on affiche le vrai bloc d'abonnement Stripe (statut +
        // formules + gerer/annuler). En demo, l'ancien affichage informatif.
        const aboHtml = (!demo && window.Chantier.abonnement)
          ? window.Chantier.abonnement.htmlReglages(fact)
          : `<div class="reg-titre">${ICON.spark} Abonnement & modules</div>
             <p class="reg-txt">Abonnement de base : ${abo}</p>`;
        blocMod.innerHTML = `
          ${aboHtml}
          <div class="reg-titre" style="margin-top:14px">Modules</div>
          <div class="mod-list">${lignes || '<p class="reg-hint">Aucun module disponible pour l\'instant.</p>'}</div>
          ${aide}`;
        if (!demo && window.Chantier.abonnement) {
          window.Chantier.abonnement.brancherReglages(blocMod);
        }
        if (demo) {
          blocMod.querySelectorAll(".mod-row.demo").forEach((row) => {
            row.addEventListener("click", () => {
              const cle = row.dataset.mod;
              let actifs;
              try { actifs = JSON.parse(localStorage.getItem("chantier_demo_modules") || "[]"); } catch (e) { actifs = []; }
              const i = actifs.indexOf(cle);
              if (i >= 0) actifs.splice(i, 1); else actifs.push(cle);
              try { localStorage.setItem("chantier_demo_modules", JSON.stringify(actifs)); } catch (e) {}
              modulesChanged = true; // la barre d'onglets sera rafraichie a la fermeture
              peindreModules();
            });
          });
        }
      };
      peindreModules();
    }

    app.appendChild(sheet);
  }

  // ---------- Barre de zoom Jour / Mois / Annee ----------
  function zoomBar() {
    const bar = el(`
      <div class="zoombar">
        <button data-vue="jour" class="${state.vue === "jour" ? "on" : ""}">Jour</button>
        <button data-vue="mois" class="${state.vue === "mois" ? "on" : ""}">Mois</button>
        <button data-vue="annee" class="${state.vue === "annee" ? "on" : ""}">Annee</button>
      </div>
    `);
    bar.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => { state.vue = b.dataset.vue; render(); });
    });
    return bar;
  }

  // ---------- Vue PATRON : planning (agenda avec zoom) ----------
  async function viewPlanning() {
    if (state.vue === "mois") return viewMois({ patron: true });
    if (state.vue === "annee") return viewAnnee({ patron: true });
    return viewJour({ patron: true });
  }

  // ---- Zoom JOUR (patron) ----
  async function viewJour({ patron }) {
    const inters = await api.listInterventions({ date: state.date });
    const cont = el(`<div class="page"></div>`);
    cont.appendChild(zoomBar());
    const bar = el(`
      <div class="datebar">
        <button class="round" id="prev">&lsaquo;</button>
        <div class="dateinfo"><b>${fmtDateFR(state.date)}</b><span>${state.date === todayISO() ? "Aujourd'hui" : ""}</span></div>
        <button class="round" id="next">&rsaquo;</button>
      </div>
    `);
    bar.querySelector("#prev").addEventListener("click", () => { state.date = decalDate(state.date, -1); render(); });
    bar.querySelector("#next").addEventListener("click", () => { state.date = decalDate(state.date, 1); render(); });
    cont.appendChild(bar);

    if (inters.length === 0) {
      cont.appendChild(el(`<div class="empty">Aucune intervention prevue ce jour.<br><span>Touchez + pour en ajouter une.</span></div>`));
    } else {
      const list = el(`<div class="list"></div>`);
      inters.forEach((it) => list.appendChild(carteInterventionPatron(it)));
      cont.appendChild(list);
    }
    cont.appendChild(fabAssistant());
    cont.appendChild(fabAjout());
    shell(cont);
  }

  function fabAjout() {
    if (enLectureSeule()) return document.createComment("lecture-seule"); // pas de creation
    const fab = el(`<button class="fab" title="Nouvelle intervention">${ICON.plus}</button>`);
    fab.addEventListener("click", () => formIntervention(null));
    return fab;
  }

  function fabAssistant() {
    if (enLectureSeule()) return document.createComment("lecture-seule"); // l'assistant ecrit
    const fab = el(`<button class="fab fab-ia" title="Assistant IA">${ICON.spark}</button>`);
    fab.addEventListener("click", assistantScreen);
    return fab;
  }

  // ---------- Assistant de planning (patron) : calendrier visible + commande en langage naturel ----------
  async function assistantScreen() {
    const ia = window.Chantier.ia;
    const vocalDispo = ia.dispo();
    let calDate = state.date; // mois affiche dans le calendrier de reference
    let jourSel = null;

    app.innerHTML = "";
    const root = el(`
      <div class="asst-screen">
        <header class="topbar">
          <button class="logout" id="back">&lsaquo; Retour</button>
          <div class="asst-titre"><span class="me-nom">${ICON.spark} Assistant</span><span class="me-role">Regardez le planning, puis dictez</span></div>
          <button class="icon-btn" id="reglages2" title="Reglages">${ICON.gear}</button>
        </header>
        <main class="asst-content">
          <div id="asst-cal"></div>
          <div id="asst-jour"></div>
        </main>
        <div class="asst-dock">
          <div class="dock-row">
            <button class="mic-btn dock-mic" id="mic" ${vocalDispo ? "" : "disabled"}>${ICON.mic}<span id="mic-lab">${vocalDispo ? "Dicter" : "Vocal indispo"}</span></button>
            <button class="primary" id="demander">Demander</button>
          </div>
          <textarea id="cmd-txt" rows="2" placeholder="Ex : deplace le chantier de Mme Roux a mardi prochain et donne-le a Lucas"></textarea>
          <div class="ia-note" id="ia-note"></div>
          <div id="proposition"></div>
        </div>
      </div>
    `);
    app.appendChild(root);

    const calBox = root.querySelector("#asst-cal");
    const jourBox = root.querySelector("#asst-jour");
    const txt = root.querySelector("#cmd-txt");
    const iaNote = root.querySelector("#ia-note");
    const propo = root.querySelector("#proposition");
    const micBtn = root.querySelector("#mic");
    const micLab = root.querySelector("#mic-lab");

    // Dictee vocale
    let dicteur = null, ecoute = false;
    if (vocalDispo) {
      let base = "";
      dicteur = ia.creerDicteur(
        (final, interim) => { txt.value = (base + " " + final + " " + interim).trim(); },
        () => { ecoute = false; micBtn.classList.remove("on"); micLab.textContent = "Dicter"; },
        (err) => { ecoute = false; micBtn.classList.remove("on"); micLab.textContent = "Dicter"; iaNote.textContent = "Micro : " + err; }
      );
      micBtn.addEventListener("click", () => {
        if (ecoute) { dicteur.arreter(); return; }
        base = txt.value.trim(); ecoute = true;
        micBtn.classList.add("on"); micLab.textContent = "J'ecoute... (toucher pour stopper)";
        dicteur.demarrer();
      });
    }

    const quitter = () => { if (dicteur) dicteur.arreter(); render(); };
    root.querySelector("#back").addEventListener("click", quitter);
    root.querySelector("#reglages2").addEventListener("click", sheetReglages);

    // Calendrier de reference (navigable, ne change pas de vue)
    async function renderCal() {
      const from = premierDuMois(calDate);
      const to = dernierDuMois(calDate);
      const inters = await api.listInterventions({ from, to });
      calBox.innerHTML = "";
      const nav = el(`
        <div class="datebar">
          <button class="round" id="pm">&lsaquo;</button>
          <div class="dateinfo"><b>${moisLabel(calDate)}</b><span>${inters.length} chantier${inters.length > 1 ? "s" : ""} ce mois</span></div>
          <button class="round" id="nm">&rsaquo;</button>
        </div>
      `);
      nav.querySelector("#pm").addEventListener("click", () => { calDate = decalMois(calDate, -1); jourSel = null; jourBox.innerHTML = ""; renderCal(); });
      nav.querySelector("#nm").addEventListener("click", () => { calDate = decalMois(calDate, 1); jourSel = null; jourBox.innerHTML = ""; renderCal(); });
      calBox.appendChild(nav);

      const [y, m] = from.split("-").map(Number);
      const nbJours = new Date(y, m, 0).getDate();
      const offset = jourSemaineLundi(from);
      const grid = el(`<div class="cal"></div>`);
      ["L", "M", "M", "J", "V", "S", "D"].forEach((j) => grid.appendChild(el(`<div class="cal-h">${j}</div>`)));
      for (let i = 0; i < offset; i++) grid.appendChild(el(`<div class="cal-cell vide"></div>`));
      for (let d = 1; d <= nbJours; d++) {
        const iso = ymd(y, m - 1, d);
        const actifs = inters.filter((it) => it.date <= iso && iso <= (it.dateFin || it.date));
        const cell = el(`
          <button class="cal-cell ${iso === todayISO() ? "auj" : ""} ${actifs.length ? "plein" : ""} ${iso === jourSel ? "sel" : ""}">
            <span class="cal-num">${d}</span><span class="cal-dots"></span>
          </button>
        `);
        const dots = cell.querySelector(".cal-dots");
        actifs.slice(0, 4).forEach((it) => dots.appendChild(el(`<span class="cd" style="background:${couleurEmploye(it.employeId)}"></span>`)));
        if (actifs.length > 4) dots.appendChild(el(`<span class="cd-plus">+${actifs.length - 4}</span>`));
        cell.addEventListener("click", () => { jourSel = iso; renderCal(); renderJour(iso, actifs); });
        grid.appendChild(cell);
      }
      calBox.appendChild(grid);
    }

    function renderJour(iso, actifs) {
      jourBox.innerHTML = "";
      jourBox.appendChild(el(`<div class="asst-jour-head">${fmtDateFR(iso)} &middot; ${actifs.length} chantier${actifs.length > 1 ? "s" : ""}</div>`));
      if (actifs.length) {
        const list = el(`<div class="asst-jour-list"></div>`);
        actifs.slice().sort((a, b) => (a.heure || "99").localeCompare(b.heure || "99")).forEach((it) => {
          list.appendChild(el(`<div class="ajl-item"><span class="ajl-h">${esc(it.heure || "--:--")}</span><span class="ajl-c">${esc(it.client)}</span><span class="ajl-e"><span class="dot" style="background:${couleurEmploye(it.employeId)}"></span>${it.employeId ? esc(nomEmploye(it.employeId)) : "?"}</span></div>`));
        });
        jourBox.appendChild(list);
      } else {
        jourBox.appendChild(el(`<div class="asst-jour-vide">Journee libre.</div>`));
      }
    }

    // Commande IA
    root.querySelector("#demander").addEventListener("click", async () => {
      const commande = txt.value.trim();
      propo.innerHTML = "";
      if (!commande) { iaNote.textContent = "Ecrivez ou dictez votre demande."; return; }
      if (!ia.aKey()) { iaNote.textContent = "Ajoutez votre cle IA (Groq) dans les Reglages (roue crantee)."; return; }
      if (ecoute && dicteur) dicteur.arreter();
      const btn = root.querySelector("#demander");
      btn.disabled = true; iaNote.textContent = "L'IA analyse votre demande...";
      try {
        // Economie de tokens IA : on n'envoie que les chantiers en cours et a
        // venir (date de fin >= aujourd'hui), pas tout l'historique.
        const chantiers = await api.listInterventions({ from: todayISO(), to: "2999-12-31" });
        const employes = employesCache.filter((e) => e.role === "employe").map((e) => ({ id: e.id, nom: e.nom }));
        const ctx = {
          today: todayISO(),
          employes,
          chantiers: chantiers.map((c) => ({ id: c.id, client: c.client, employeId: c.employeId, employe: c.employeId ? nomEmploye(c.employeId) : "non assigne", date: c.date, dateFin: c.dateFin || c.date })),
        };
        const r = await ia.assistantPlanning(commande, ctx);
        iaNote.textContent = "";
        afficherProposition(r);
      } catch (e) {
        iaNote.textContent = String(e.message).startsWith("no-key")
          ? "Ajoutez votre cle IA dans les Reglages."
          : "IA indisponible (" + e.message + ").";
      } finally { btn.disabled = false; }
    });

    function afficherProposition(r) {
      const ch = (r.changements || {});
      const rien = !ch.date && !ch.dateFin && !ch.employeId;
      if (!r.chantierId || rien || r.question) {
        propo.innerHTML = `<div class="propo q">${ICON.spark}<span>${esc(r.question || "Je n'ai pas trouve le chantier concerne. Reformulez en precisant le client.")}</span></div>`;
        return;
      }
      propo.innerHTML = `
        <div class="propo">
          <div class="propo-titre">Action proposee</div>
          <div class="propo-resume">${esc(r.resume || "Modifier le chantier.")}</div>
          <div class="propo-actions">
            <button class="ghost2" id="annuler">Annuler</button>
            <button class="primary" id="confirmer">Confirmer</button>
          </div>
        </div>`;
      propo.querySelector("#annuler").addEventListener("click", () => { propo.innerHTML = ""; });
      propo.querySelector("#confirmer").addEventListener("click", async () => {
        const patch = {};
        if (ch.date) patch.date = ch.date;
        if (ch.dateFin) patch.dateFin = ch.dateFin;
        if (ch.employeId) patch.employeId = ch.employeId;
        await api.updateIntervention(r.chantierId, patch);
        if (dicteur) dicteur.arreter();
        if (patch.date) { state.date = patch.date; state.vue = "jour"; }
        render();
      });
    }

    renderCal();
  }

  // ---------- Vue MOIS : calendrier du mois ----------
  async function viewMois({ patron }) {
    const from = premierDuMois(state.date);
    const to = dernierDuMois(state.date);
    const filtre = { from, to };
    if (!patron) filtre.employeId = state.me.id;
    const inters = await api.listInterventions(filtre);

    const cont = el(`<div class="page"></div>`);
    cont.appendChild(zoomBar());
    const nav = el(`
      <div class="datebar">
        <button class="round" id="prev">&lsaquo;</button>
        <div class="dateinfo"><b>${moisLabel(state.date)}</b><span>${inters.length} chantier${inters.length > 1 ? "s" : ""} ce mois</span></div>
        <button class="round" id="next">&rsaquo;</button>
      </div>
    `);
    nav.querySelector("#prev").addEventListener("click", () => { state.date = decalMois(state.date, -1); render(); });
    nav.querySelector("#next").addEventListener("click", () => { state.date = decalMois(state.date, 1); render(); });
    cont.appendChild(nav);

    const [y, m] = from.split("-").map(Number);
    const nbJours = new Date(y, m, 0).getDate();
    const offset = jourSemaineLundi(from);
    const grid = el(`<div class="cal"></div>`);
    ["L", "M", "M", "J", "V", "S", "D"].forEach((j) => grid.appendChild(el(`<div class="cal-h">${j}</div>`)));
    for (let i = 0; i < offset; i++) grid.appendChild(el(`<div class="cal-cell vide"></div>`));
    for (let d = 1; d <= nbJours; d++) {
      const iso = ymd(y, m - 1, d);
      const actifs = inters.filter((it) => it.date <= iso && iso <= (it.dateFin || it.date));
      const estAuj = iso === todayISO();
      const cell = el(`
        <button class="cal-cell ${estAuj ? "auj" : ""} ${actifs.length ? "plein" : ""}">
          <span class="cal-num">${d}</span>
          <span class="cal-dots"></span>
        </button>
      `);
      const dots = cell.querySelector(".cal-dots");
      actifs.slice(0, 4).forEach((it) => dots.appendChild(el(`<span class="cd" style="background:${couleurEmploye(it.employeId)}"></span>`)));
      if (actifs.length > 4) dots.appendChild(el(`<span class="cd-plus">+${actifs.length - 4}</span>`));
      cell.addEventListener("click", () => { state.date = iso; state.vue = "jour"; render(); });
      grid.appendChild(cell);
    }
    cont.appendChild(grid);
    if (patron) { cont.appendChild(fabAssistant()); cont.appendChild(fabAjout()); }
    shell(cont);
  }

  // ---------- Vue ANNEE : les 12 mois d'un coup ----------
  async function viewAnnee({ patron }) {
    const an = anneeOf(state.date);
    const filtre = { from: an + "-01-01", to: an + "-12-31" };
    if (!patron) filtre.employeId = state.me.id;
    const inters = await api.listInterventions(filtre);

    const cont = el(`<div class="page"></div>`);
    cont.appendChild(zoomBar());
    const nav = el(`
      <div class="datebar">
        <button class="round" id="prev">&lsaquo;</button>
        <div class="dateinfo"><b>${an}</b><span>${inters.length} chantier${inters.length > 1 ? "s" : ""} dans l'annee</span></div>
        <button class="round" id="next">&rsaquo;</button>
      </div>
    `);
    nav.querySelector("#prev").addEventListener("click", () => { state.date = decalAnnee(state.date, -1); render(); });
    nav.querySelector("#next").addEventListener("click", () => { state.date = decalAnnee(state.date, 1); render(); });
    cont.appendChild(nav);

    const grille = el(`<div class="annee"></div>`);
    for (let mo = 0; mo < 12; mo++) {
      const debut = ymd(+an, mo, 1);
      const fin = ymd(+an, mo, new Date(+an, mo + 1, 0).getDate());
      const duMois = inters.filter((it) => it.date <= fin && (it.dateFin || it.date) >= debut);
      const couleurs = [...new Set(duMois.map((it) => couleurEmploye(it.employeId)))].slice(0, 4);
      const carte = el(`
        <button class="mois-card ${duMois.length ? "actif" : ""}">
          <span class="mc-nom">${MOIS_COURT[mo]}</span>
          <span class="mc-nb">${duMois.length || ""}</span>
          <span class="mc-dots">${couleurs.map((c) => `<span class="cd" style="background:${c}"></span>`).join("")}</span>
        </button>
      `);
      carte.addEventListener("click", () => { state.date = debut; state.vue = "mois"; render(); });
      grille.appendChild(carte);
    }
    cont.appendChild(grille);
    shell(cont);
  }

  function carteInterventionPatron(it) {
    const c = el(`
      <div class="card ${estLong(it) ? "long" : ""}">
        <div class="card-side" style="background:${couleurEmploye(it.employeId)}"></div>
        <div class="card-body">
          <div class="card-top">
            <span class="heure">${esc(it.heure || "--:--")}</span>
            <span class="top-badges">${chipChantier(it)}${badgeStatut(it.statut)}</span>
          </div>
          <div class="card-client">${esc(it.client)}</div>
          <div class="card-adr">${ICON.map}${esc(it.adresse)}</div>
          <div class="card-desc">${esc(it.description)}</div>
          <div class="card-foot">
            <span class="assig"><span class="dot" style="background:${couleurEmploye(it.employeId)}"></span>${it.employeId ? esc(nomEmploye(it.employeId)) : "Non assigne"}</span>
            <button class="mini" data-act="detail">Voir les heures</button>
          </div>
        </div>
      </div>
    `);
    c.querySelector('[data-act="detail"]').addEventListener("click", (e) => { e.stopPropagation(); detailChantier(it.id); });
    c.querySelector(".card-body").addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      detailChantier(it.id);
    });
    return c;
  }

  // ---------- Journal de suivi (employe) : dictee vocale + compte-rendu IA ----------
  async function journalChantier(id) {
    const ia = window.Chantier.ia;
    const it = await api.getIntervention(id);
    if (!it) return;
    const notes = await api.listJournal(id);
    const lignes = notes.length
      ? notes.map((n) => ligneNote(n, id, true)).join("")
      : `<div class="jour-vide">Aucun suivi pour l'instant. Dictez le premier ci-dessous.</div>`;
    const vocalDispo = ia.dispo();
    const sheet = el(`
      <div class="modal">
        <div class="sheet">
          <div class="sheet-head"><h2>Suivi du chantier</h2><button class="x" id="close">&times;</button></div>
          <div class="sheet-body">
            <div class="det-sub">${esc(it.client)} &middot; ${esc(it.adresse)}</div>
            <div class="composer">
              <button class="mic-btn" id="mic" ${vocalDispo ? "" : "disabled"}>${ICON.mic}<span id="mic-lab">${vocalDispo ? "Dicter" : "Vocal indispo"}</span></button>
              <textarea id="note-txt" rows="4" placeholder="${vocalDispo ? "Appuyez sur Dicter et parlez, ou ecrivez ici..." : "Ecrivez votre note de suivi ici..."}"></textarea>
              <div class="composer-actions">
                <button class="act-btn ia-btn" id="reformuler">${ICON.spark}Ameliorer avec l'IA</button>
                <button class="primary" id="enregistrer">Enregistrer</button>
              </div>
              <div class="ia-note" id="ia-note"></div>
            </div>
            <div class="jours-title">Historique du suivi</div>
            <div class="jours-list" id="hist">${lignes}</div>
          </div>
        </div>
      </div>
    `);
    const close = () => { if (dicteur) dicteur.arreter(); sheet.remove(); };
    sheet.querySelector("#close").addEventListener("click", close);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });

    const txt = sheet.querySelector("#note-txt");
    const iaNote = sheet.querySelector("#ia-note");
    let parIA = false;
    let brutMemo = "";

    // Dictee vocale
    let dicteur = null;
    let ecoute = false;
    const micBtn = sheet.querySelector("#mic");
    const micLab = sheet.querySelector("#mic-lab");
    if (vocalDispo) {
      let base = "";
      dicteur = ia.creerDicteur(
        (final, interim) => { txt.value = (base + " " + final + " " + interim).trim(); },
        () => { ecoute = false; micBtn.classList.remove("on"); micLab.textContent = "Dicter"; },
        (err) => { ecoute = false; micBtn.classList.remove("on"); micLab.textContent = "Dicter"; iaNote.textContent = "Micro : " + err + " (autorisez le micro, sous Chrome)."; }
      );
      micBtn.addEventListener("click", () => {
        if (!dicteur) return;
        if (ecoute) { dicteur.arreter(); return; }
        base = txt.value.trim();
        ecoute = true; parIA = false;
        micBtn.classList.add("on"); micLab.textContent = "J'ecoute... (toucher pour stopper)";
        iaNote.textContent = "";
        dicteur.demarrer();
      });
    }

    // Reformulation IA
    sheet.querySelector("#reformuler").addEventListener("click", async () => {
      const brut = txt.value.trim();
      if (!brut) { iaNote.textContent = "Dictez ou ecrivez d'abord une note."; return; }
      if (!ia.aKey()) { iaNote.innerHTML = 'Ajoutez votre cle IA (Groq) dans les Reglages (roue crantee en haut).'; return; }
      if (ecoute && dicteur) dicteur.arreter();
      const btn = sheet.querySelector("#reformuler");
      btn.disabled = true; iaNote.textContent = "L'IA reformule votre note...";
      try {
        const propre = await ia.reformuler(brut, it.client + " - " + it.description);
        if (propre) { brutMemo = brut; txt.value = propre; parIA = true; iaNote.textContent = "Reformule par l'IA. Vous pouvez corriger avant d'enregistrer."; }
        else iaNote.textContent = "L'IA n'a rien renvoye, gardez votre note.";
      } catch (e) {
        iaNote.textContent = String(e.message).startsWith("no-key")
          ? "Ajoutez votre cle IA dans les Reglages."
          : "IA indisponible (" + e.message + "). Vous pouvez enregistrer la note telle quelle.";
      } finally { btn.disabled = false; }
    });

    // Enregistrer
    sheet.querySelector("#enregistrer").addEventListener("click", async () => {
      const texte = txt.value.trim();
      if (!texte) { iaNote.textContent = "Note vide."; return; }
      if (ecoute && dicteur) dicteur.arreter();
      await api.ajouterNote(id, { texte, brut: parIA ? brutMemo : "", employeId: state.me.id, parIA });
      close();
      render();
    });

    // Suppression d'une note de l'historique
    sheet.querySelector("#hist").addEventListener("click", async (e) => {
      const del = e.target.closest("[data-del]");
      if (!del) return;
      if (!confirm("Supprimer cette note de suivi ?")) return;
      await api.supprimerNote(del.dataset.int, del.dataset.del);
      const item = del.closest(".note-item");
      if (item) item.remove();
      const hist = sheet.querySelector("#hist");
      if (!hist.querySelector(".note-item")) hist.innerHTML = `<div class="jour-vide">Aucun suivi pour l'instant. Dictez le premier ci-dessous.</div>`;
    });

    app.appendChild(sheet);
  }

  function ligneNote(n, interventionId, effacable) {
    const quand = new Date(n.ts);
    const dateStr = fmtDateFR(quand.toISOString().slice(0, 10)) + " " + String(quand.getHours()).padStart(2, "0") + "h" + String(quand.getMinutes()).padStart(2, "0");
    return `
      <div class="note-item" data-note="${n.id}">
        <div class="note-head">
          <span class="note-qui"><span class="dot" style="background:${couleurEmploye(n.employeId)}"></span>${esc(nomEmploye(n.employeId))}</span>
          <span class="note-meta">${n.parIA ? `<span class="tag-ia">${ICON.spark}IA</span>` : ""}<span class="note-date">${dateStr}</span></span>
        </div>
        <div class="note-txt">${esc(n.texte)}</div>
        ${effacable ? `<button class="note-del" data-del="${n.id}" data-int="${interventionId}" title="Supprimer">${ICON.trash}</button>` : ""}
      </div>`;
  }

  // ---------- Detail d'un chantier (patron) : heures cumulees sur la periode ----------
  async function detailChantier(id) {
    const it = await api.getIntervention(id);
    if (!it) return;
    const pts = await api.listPointages({ interventionId: id });
    // Regroupe les pointages par jour
    const parJour = {};
    let totalMs = 0;
    pts.forEach((p) => {
      const jour = new Date(p.debut).toISOString().slice(0, 10);
      const ms = (p.fin || Date.now()) - p.debut;
      parJour[jour] = (parJour[jour] || 0) + ms;
      totalMs += ms;
    });
    const jours = Object.keys(parJour).sort();
    const periode = estLong(it)
      ? `Du ${fmtDateFR(it.date)} au ${fmtDateFR(it.dateFin)} (${joursEntre(it.date, it.dateFin)} jours)`
      : fmtDateFR(it.date);
    const lignesJours = jours.length
      ? jours.map((j) => `<div class="jour-row"><span>${fmtDateFR(j)}</span><b>${dureeStr(parJour[j])}</b></div>`).join("")
      : `<div class="jour-vide">Aucune heure pointee pour l'instant.</div>`;
    const notes = await api.listJournal(id);
    const lignesNotes = notes.length
      ? notes.map((n) => ligneNote(n, id, false)).join("")
      : `<div class="jour-vide">Aucun suivi de chantier envoye par l'equipe.</div>`;
    const sheet = el(`
      <div class="modal">
        <div class="sheet">
          <div class="sheet-head">
            <h2>${esc(it.client)}</h2>
            <button class="x" id="close">&times;</button>
          </div>
          <div class="sheet-body">
            <div class="det-meta">
              <div class="det-line">${ICON.map}<span>${esc(it.adresse)}</span></div>
              <div class="det-line">${ICON.planning}<span>${periode}</span></div>
              <div class="det-line"><span class="dot" style="background:${couleurEmploye(it.employeId)}"></span><span>${it.employeId ? esc(nomEmploye(it.employeId)) : "Non assigne"}</span> ${badgeStatut(it.statut)}</div>
            </div>
            <div class="det-desc">${esc(it.description)}</div>
            <div class="total-box">
              <span class="lab">Total des heures pointees</span>
              <span class="total-big">${totalMs > 0 ? dureeStr(totalMs) : "0h00"}</span>
            </div>
            <div class="jours-title">Detail par jour</div>
            <div class="jours-list">${lignesJours}</div>
            <div class="jours-title">${ICON.note} Suivi du chantier</div>
            <div class="jours-list">${lignesNotes}</div>
          </div>
          <div class="sheet-foot">
            <button class="danger" id="edit">Modifier</button>
            ${estLong(it) ? (it.statut === "termine"
              ? '<button class="ghost2" id="reopen">Rouvrir le chantier</button>'
              : '<button class="primary" id="done">Chantier termine</button>') : "<span></span>"}
          </div>
        </div>
      </div>
    `);
    const close = () => sheet.remove();
    sheet.querySelector("#close").addEventListener("click", close);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
    sheet.querySelector("#edit").addEventListener("click", () => { close(); formIntervention(it); });
    const doneBtn = sheet.querySelector("#done");
    if (doneBtn) doneBtn.addEventListener("click", async () => { await api.setStatut(id, "termine"); close(); render(); });
    const reopenBtn = sheet.querySelector("#reopen");
    if (reopenBtn) reopenBtn.addEventListener("click", async () => { await api.setStatut(id, "en_cours"); close(); render(); });
    app.appendChild(sheet);
  }

  function badgeStatut(s) {
    const map = {
      a_faire: ["A faire", "b-todo"],
      en_cours: ["En cours", "b-run"],
      termine: ["Termine", "b-done"],
    };
    const [txt, cls] = map[s] || map.a_faire;
    return `<span class="badge ${cls}">${txt}</span>`;
  }

  function decalDate(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d + n);
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  }

  // ---------- Formulaire intervention (creer / modifier) ----------
  function formIntervention(it) {
    const edition = !!it;
    const data = it || { date: state.date, heure: "", employeId: "", client: "", adresse: "", tel: "", description: "" };
    const opts = employesCache.filter((e) => e.role === "employe")
      .map((e) => `<option value="${e.id}" ${e.id === data.employeId ? "selected" : ""}>${esc(e.nom)}</option>`).join("");
    const sheet = el(`
      <div class="modal">
        <div class="sheet">
          <div class="sheet-head">
            <h2>${edition ? "Modifier l'intervention" : "Nouvelle intervention"}</h2>
            <button class="x" id="close">&times;</button>
          </div>
          <div class="sheet-body">
            <label>Client<input id="f-client" type="text" value="${esc(data.client)}" placeholder="Nom du client"></label>
            <label>Adresse<input id="f-adresse" type="text" value="${esc(data.adresse)}" placeholder="Adresse du chantier"></label>
            <label>Telephone<input id="f-tel" type="tel" value="${esc(data.tel)}" placeholder="06 ..."></label>
            <div class="row2">
              <label>Debut<input id="f-date" type="date" value="${esc(data.date)}"></label>
              <label>Heure<input id="f-heure" type="time" value="${esc(data.heure)}"></label>
            </div>
            <label>Fin du chantier <span class="opt">(si plusieurs jours, sinon laissez vide)</span><input id="f-datefin" type="date" value="${esc(data.dateFin && data.dateFin !== data.date ? data.dateFin : "")}"></label>
            <label>Assigner a<select id="f-employe"><option value="">Non assigne</option>${opts}</select></label>
            <label>Travail a faire<textarea id="f-desc" rows="3" placeholder="Ex : fuite sous evier, remplacer le siphon">${esc(data.description)}</textarea></label>
          </div>
          <div class="sheet-foot">
            ${edition ? '<button class="danger" id="del">Supprimer</button>' : "<span></span>"}
            <button class="primary" id="save">${edition ? "Enregistrer" : "Ajouter"}</button>
          </div>
        </div>
      </div>
    `);
    const close = () => sheet.remove();
    sheet.querySelector("#close").addEventListener("click", close);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
    sheet.querySelector("#save").addEventListener("click", async () => {
      const dDebut = sheet.querySelector("#f-date").value || todayISO();
      const dFin = sheet.querySelector("#f-datefin").value;
      const payload = {
        client: sheet.querySelector("#f-client").value.trim(),
        adresse: sheet.querySelector("#f-adresse").value.trim(),
        tel: sheet.querySelector("#f-tel").value.trim(),
        date: dDebut,
        dateFin: dFin && dFin >= dDebut ? dFin : dDebut,
        heure: sheet.querySelector("#f-heure").value,
        employeId: sheet.querySelector("#f-employe").value || null,
        description: sheet.querySelector("#f-desc").value.trim(),
      };
      if (!payload.client) { alert("Indiquez au moins le nom du client."); return; }
      if (dFin && dFin < dDebut) { alert("La date de fin doit etre apres le debut."); return; }
      if (edition) await api.updateIntervention(it.id, payload);
      else await api.createIntervention(payload);
      state.date = payload.date;
      close();
      render();
    });
    if (edition) {
      sheet.querySelector("#del").addEventListener("click", async () => {
        if (!confirm("Supprimer cette intervention ?")) return;
        await api.deleteIntervention(it.id);
        close();
        render();
      });
    }
    app.appendChild(sheet);
  }

  // ---------- Vue PATRON : equipe / heures ----------
  async function viewEquipe() {
    const [inters, pointages] = await Promise.all([
      api.listInterventions({ date: state.date }),
      api.listPointages({}),
    ]);
    const cont = el(`<div class="page"></div>`);
    cont.appendChild(el(`
      <div class="datebar">
        <button class="round" id="prev">&lsaquo;</button>
        <div class="dateinfo"><b>${fmtDateFR(state.date)}</b><span>Heures de l'equipe</span></div>
        <button class="round" id="next">&rsaquo;</button>
      </div>
    `));
    cont.querySelector("#prev").addEventListener("click", () => { state.date = decalDate(state.date, -1); render(); });
    cont.querySelector("#next").addEventListener("click", () => { state.date = decalDate(state.date, 1); render(); });

    const employes = employesCache.filter((e) => e.role === "employe");
    const list = el(`<div class="list"></div>`);
    const debutJour = new Date(state.date + "T00:00:00").getTime();
    const finJour = debutJour + 86400000;

    employes.forEach((e) => {
      const pts = pointages.filter((p) => p.employeId === e.id && p.debut >= debutJour && p.debut < finJour);
      let totalMs = 0;
      pts.forEach((p) => { totalMs += (p.fin || Date.now()) - p.debut; });
      const nbInter = inters.filter((i) => i.employeId === e.id).length;
      const nbFait = inters.filter((i) => i.employeId === e.id && i.statut === "termine").length;
      const enCours = pts.some((p) => !p.fin);
      const card = el(`
        <div class="card team">
          <div class="card-side" style="background:${e.couleur}"></div>
          <div class="card-body">
            <div class="team-top">
              <span class="avatar sm" style="background:${e.couleur}">${esc(initiales(e.nom))}</span>
              <b>${esc(e.nom)}</b>
              ${enCours ? '<span class="badge b-run">En intervention</span>' : ""}
            </div>
            <div class="team-stats">
              <div><span class="big">${totalMs > 0 ? dureeStr(totalMs) : "0h00"}</span><span class="lab">pointees</span></div>
              <div><span class="big">${nbFait}/${nbInter}</span><span class="lab">chantiers</span></div>
            </div>
          </div>
        </div>
      `);
      list.appendChild(card);
    });
    if (employes.length === 0) list.appendChild(el(`<div class="empty">Aucun employe.</div>`));
    cont.appendChild(list);
    shell(cont);
  }

  // ---------- Vue EMPLOYE : ma tournee (agenda avec zoom) ----------
  async function viewTournee() {
    if (state.vue === "mois") return viewMois({ patron: false });
    if (state.vue === "annee") return viewAnnee({ patron: false });
    const [inters, ptEnCours] = await Promise.all([
      api.listInterventions({ date: state.date, employeId: state.me.id }),
      api.pointageEnCours(state.me.id),
    ]);
    const cont = el(`<div class="page"></div>`);
    cont.appendChild(zoomBar());
    const nav = el(`
      <div class="datebar">
        <button class="round" id="prev">&lsaquo;</button>
        <div class="dateinfo"><b>${fmtDateFR(state.date)}</b><span>${state.date === todayISO() ? "Ma tournee du jour" : "Ma tournee"}</span></div>
        <button class="round" id="next">&rsaquo;</button>
      </div>
    `);
    nav.querySelector("#prev").addEventListener("click", () => { state.date = decalDate(state.date, -1); render(); });
    nav.querySelector("#next").addEventListener("click", () => { state.date = decalDate(state.date, 1); render(); });
    cont.appendChild(nav);

    if (inters.length === 0) {
      cont.appendChild(el(`<div class="empty">Rien de prevu pour vous ce jour.<br><span>Bonne journee !</span></div>`));
      shell(cont);
      return;
    }
    const list = el(`<div class="list"></div>`);
    inters.forEach((it) => list.appendChild(carteInterventionEmploye(it, ptEnCours)));
    cont.appendChild(list);
    shell(cont);
  }

  function carteInterventionEmploye(it, ptEnCours) {
    const actif = ptEnCours && ptEnCours.interventionId === it.id;
    const long = estLong(it);
    const c = el(`
      <div class="card ${actif ? "actif" : ""} ${long ? "long" : ""}">
        <div class="card-side" style="background:${actif ? "#f59e0b" : couleurEmploye(it.employeId)}"></div>
        <div class="card-body">
          <div class="card-top">
            <span class="heure">${esc(it.heure || "--:--")}</span>
            <span class="top-badges">${chipChantier(it)}${badgeStatut(it.statut)}</span>
          </div>
          <div class="card-client">${esc(it.client)}</div>
          <div class="card-adr">${ICON.map}${esc(it.adresse)}</div>
          <div class="card-desc">${esc(it.description)}</div>
          <div class="card-actions"></div>
        </div>
      </div>
    `);
    const zone = c.querySelector(".card-actions");
    if (it.tel) {
      zone.appendChild(el(`<a class="act-btn" href="tel:${esc(it.tel)}">${ICON.phone}Appeler</a>`));
    }
    if (it.adresse) {
      const q = encodeURIComponent(it.adresse);
      zone.appendChild(el(`<a class="act-btn" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${ICON.map}Itineraire</a>`));
    }
    // Suivi de chantier (note vocale + IA)
    const nbNotes = (it.journal || []).length;
    const suivi = el(`<button class="act-btn suivi">${ICON.note}Suivi${nbNotes ? ` <span class="pill">${nbNotes}</span>` : ""}</button>`);
    suivi.addEventListener("click", () => journalChantier(it.id));
    zone.appendChild(suivi);
    // Pointage
    if (it.statut === "termine" && !actif) {
      zone.appendChild(el(`<span class="done-tag">Chantier termine</span>`));
    } else if (actif) {
      const stop = el(`<button class="act-btn stop">${long ? "Arreter ma journee" : "Terminer"}</button>`);
      stop.addEventListener("click", async () => {
        await api.terminerPointage(ptEnCours.id);
        render();
      });
      zone.appendChild(stop);
    } else {
      const start = el(`<button class="act-btn go">${long ? "Demarrer ma journee" : "Demarrer"}</button>`);
      start.addEventListener("click", async () => {
        await api.demarrerPointage(it.id, state.me.id);
        render();
      });
      zone.appendChild(start);
    }
    // Chantier long non termine : bouton pour cloturer tout le chantier
    if (long && it.statut !== "termine") {
      const done = el(`<button class="act-btn done-long">Chantier fini</button>`);
      done.addEventListener("click", async () => {
        if (actif) await api.terminerPointage(ptEnCours.id);
        await api.setStatut(it.id, "termine");
        render();
      });
      zone.appendChild(done);
    }
    return c;
  }

  // ---------- Synchro temps reel (mode cloud) ----------
  let syncStop = null;
  let refreshT = null;
  function demarrerSync() {
    if (syncStop || !api.estCloud || !api.subscribeChanges) return;
    syncStop = api.subscribeChanges(() => {
      clearTimeout(refreshT);
      refreshT = setTimeout(rafraichirSiSur, 450); // regroupe les rafales
    });
  }
  function arreterSync() {
    if (syncStop) { syncStop.unsubscribe(); syncStop = null; }
    clearTimeout(refreshT);
  }
  function rafraichirSiSur() {
    if (!state.me) return;
    // Ne pas rafraichir si une feuille/l'assistant est ouvert, ou si on tape :
    // on ne veut rien effacer sous les doigts de l'utilisateur.
    if (document.querySelector(".modal") || document.querySelector(".asst-screen")) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    render();
  }

  // ---------- Routeur ----------
  async function render() {
    if (!state.me) { renderLogin(); return; }
    // Acces (cloud) : si l'abonnement est ferme (essai expire, past_due,
    // impaye, resilie hors periode payee), on passe en LECTURE SEULE. La
    // consultation reste possible ; les ecritures sont bloquees (serveur + UI)
    // et un bandeau clair invite a s'abonner. Choix produit : lecture seule
    // plutot qu'un mur, pour que le client retrouve ses donnees.
    state.lectureSeule = false;
    if (api.estCloud && window.Chantier.abonnement) {
      const fact = api.facturation ? api.facturation() : null;
      state.lectureSeule = !!(fact && !window.Chantier.abonnement.ouvert(fact));
    }
    demarrerSync();
    features.charger(api.modulesActifs ? api.modulesActifs() : []);
    employesCache = await api.listEmployes();
    if (state.me.role === "patron") {
      if (state.onglet === "metier") {
        const cle = metierActif();
        if (cle) {
          const cont = await window.Chantier[cle].page();
          return shell(cont);
        }
      }
      if (state.onglet === "equipe") return viewEquipe();
      return viewPlanning();
    }
    return viewTournee();
  }

  // Ponts pour les modules metier (js/plombier.js) : re-render et navigation.
  window.Chantier.rerender = render;
  window.Chantier.allerPlanning = function (iso) {
    state.onglet = "planning";
    if (iso) { state.date = iso; state.vue = "jour"; }
    render();
  };

  // ---------- Demarrage ----------
  async function boot() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    try {
      if (api.init) await api.init(); // cloud : restaure la session + charge le profil
    } catch (e) {
      console.warn("init backend:", e);
    }
    // Retour de Stripe Checkout. REGLE 8 : on n'accorde JAMAIS l'acces sur le
    // seul retour de page ; on relit la base (le webhook signe fait foi). Le
    // webhook peut avoir un leger decalage => on attend qu'il ait ecrit.
    let pendingAboMsg = null;
    try {
      const params = new URLSearchParams(location.search);
      if (params.has("abo")) {
        const retour = params.get("abo");
        history.replaceState(null, "", location.pathname);
        if (retour === "ok") {
          let f = null;
          try {
            f = api.attendreActivation ? await api.attendreActivation()
              : (api.rechargerFacturation ? await api.rechargerFacturation() : null);
          } catch (e) {}
          pendingAboMsg = (f && f.ouvert)
            ? { type: "ok", texte: "Paiement confirme, votre abonnement est actif. Merci !" }
            : { type: "attente", texte: "Paiement bien recu. L'activation est en cours de validation, cela peut prendre quelques secondes. Actualisez si l'acces n'est pas encore ouvert." };
        } else if (retour === "annule") {
          pendingAboMsg = { type: "info", texte: "Paiement annule. Vous pouvez choisir une formule quand vous voulez." };
        }
      }
    } catch (e) {}
    const sess = api.getSession();
    if (sess) {
      state.me = sess;
      state.onglet = sess.role === "patron" ? "planning" : "tournee";
      employesCache = await api.listEmployes();
    }
    render();
    if (pendingAboMsg) montrerToast(pendingAboMsg.texte, pendingAboMsg.type);
  }

  // Modale d'abonnement (choix de formule / gestion), ouverte depuis le bandeau
  // lecture seule. Reutilise le bloc reglages d'abonnement deja teste.
  function ouvrirAbonnementModal() {
    if (!window.Chantier.abonnement) return;
    const fact = api.facturation ? api.facturation() : null;
    const sheet = el(`
      <div class="modal">
        <div class="sheet">
          <div class="sheet-head"><h2>Abonnement</h2><button class="x" id="close">&times;</button></div>
          <div class="sheet-body"><div class="reg-bloc" id="abo-bloc"></div></div>
        </div>
      </div>
    `);
    const bloc = sheet.querySelector("#abo-bloc");
    bloc.innerHTML = window.Chantier.abonnement.htmlReglages(fact);
    window.Chantier.abonnement.brancherReglages(bloc);
    const close = () => sheet.remove();
    sheet.querySelector("#close").addEventListener("click", close);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
    app.appendChild(sheet);
  }

  // Petit bandeau de confirmation (retour de paiement). Styles inline (CSP OK).
  function montrerToast(texte, type) {
    const couleur = type === "ok" ? "#16a34a" : (type === "attente" ? "#b45309" : "#334155");
    const t = el('<div class="abo-toast" role="status"></div>');
    t.textContent = texte;
    t.setAttribute("style",
      "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(78px + env(safe-area-inset-bottom));" +
      "z-index:99999;max-width:440px;width:calc(100% - 24px);background:" + couleur + ";color:#fff;" +
      "padding:12px 40px 12px 16px;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.35);font-size:14px;line-height:1.4;");
    const close = el('<button aria-label="Fermer" style="position:absolute;top:6px;right:8px;background:transparent;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1;">&times;</button>');
    close.addEventListener("click", () => { try { t.remove(); } catch (e) {} });
    t.appendChild(close);
    document.body.appendChild(t);
    setTimeout(() => { try { t.remove(); } catch (e) {} }, 10000);
  }

  boot();
})();
