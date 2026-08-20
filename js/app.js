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
      "setStatut", "demarrerPointage", "terminerPointage", "ajouterNote", "supprimerNote",
      "createClient", "updateClient", "createCatalogCategory", "createCatalogItem",
      "updateCatalogItem", "linkInterventionClient"];
    METHODES.forEach((m) => {
      if (!api || typeof api[m] !== "function") return;
      const orig = api[m].bind(api);
      api[m] = function () {
        if (enLectureSeule()) {
          montrerToast("Période d'essai terminée. Abonnez-vous pour créer ou modifier.", "attente");
          return Promise.reject(new Error("lecture-seule"));
        }
        return orig.apply(api, arguments);
      };
    });
  })();

  // ---------- Modules inclus selon la formule d'abonnement ----------
  // Une seule constante décrit les modules embarqués dans ClicChantier.
  // Aucun prix individuel : le serveur calcule les droits depuis l'abonnement.
  const MODULES_CATALOGUE = {
    stock: { libelle: "Stock et matériaux", desc: "Quantités, seuils de réapprovisionnement et valeur du stock.", pret: true },
    profitability: { libelle: "Rentabilité", desc: "Coûts, marge et rentabilité par chantier.", pret: true },
    voice: { libelle: "Compte rendu vocal", desc: "Dictée terrain et validation humaine du compte rendu.", pret: true },
    supplier_invoices: { libelle: "Factures fournisseurs", desc: "Import, contrôle et validation humaine des dépenses.", pret: true },
    plombier: { libelle: "Pack Plomberie / Chauffage", desc: "Contrats, catalogue, attestations et TVA.", pret: true },
    electricien: { libelle: "Pack Électricien", desc: "Calculateurs NF C 15-100, catalogue et attestations.", pret: true },
    peintre: { libelle: "Pack Peintre en bâtiment", desc: "Métrés, catalogue, réception des travaux et TVA.", pret: true },
  };
  // ⛔ « billing » a été retiré : la facturation est passée dans le SOCLE au
  // palier 2, elle est donc incluse dès Essentiel. Un module ferait doublon
  // avec une fonction déjà livrée à tout le monde.
  const MODULES_ORDRE = ["stock", "profitability", "voice", "supplier_invoices", "plombier", "electricien", "peintre"];

  // Couche de detection : "cette fonction est-elle incluse dans la formule ?"
  window.Chantier.features = {
    _actifs: [],
    charger(liste) { this._actifs = Array.isArray(liste) ? liste : []; },
    actif(cle) { return this._actifs.indexOf(cle) !== -1; },
    liste() { return this._actifs.slice(); },
  };
  const features = window.Chantier.features;
  // Les trois packs métier sont ouverts par la formule, mais une entreprise
  // n'en exerce QU'UN. Afficher les deux autres serait du bruit.
  const PACKS_METIER = ["plombier", "electricien", "peintre"];
  let metierCourant = null;   // rafraichi a chaque rendu, comme les droits
  function modulesActifsCharges() {
    const metier = metierCourant;
    return MODULES_ORDRE.filter((cle) => {
      if (!MODULES_CATALOGUE[cle].pret) return false;
      if (!features.actif(cle)) return false;
      if (!window.Chantier[cle] || typeof window.Chantier[cle].page !== "function") return false;
      // Métier inconnu : on montre les trois plutôt que d'en cacher un utile.
      if (PACKS_METIER.indexOf(cle) !== -1 && metier) return cle === metier;
      return true;
    });
  }

  const state = {
    me: null, // employe connecte (patron ou employe)
    onglet: "planning", // patron: planning | equipe | modules ; employe: tournee
    moduleCle: null, // module ouvert dans l'espace Modules
    socleVue: null, // null | clients | client | catalogue | article | rapprochement | devis | devisFiche
    clientId: null,
    catalogItemId: null,
    devisId: null,
    factureId: null,
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
    const mois = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
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
  const MOIS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
  const MOIS_COURT = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
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
  // Selecteur de mode, present sur les DEUX ecrans de connexion : sans lui, le
  // seul chemin vers la creation de compte passait par les reglages, donc il
  // fallait d'abord entrer dans la demo. Un client n'avait aucune chance de le
  // trouver. Reporte depuis la version de juillet le 2026-08-20, il avait
  // disparu de la branche de developpement.
  function modeSwitchHTML(cloud) {
    return `
      <div class="mode-switch" role="group" aria-label="Choisir le mode">
        <button type="button" data-mode="demo" class="${cloud ? "" : "on"}" aria-pressed="${cloud ? "false" : "true"}">
          Essayer la démo
        </button>
        <button type="button" data-mode="supabase" class="${cloud ? "on" : ""}" aria-pressed="${cloud ? "true" : "false"}">
          Mon entreprise
        </button>
      </div>
      <p class="mode-hint">${cloud
        ? "Connectez-vous ou créez votre entreprise. Vos données sont synchronisées entre le patron et les employés."
        : "La démo est un chantier fictif, pour visiter l'application sans compte. Choisissez <b>Mon entreprise</b> pour créer le vôtre."}</p>`;
  }

  // Branche le selecteur. Le backend est choisi au chargement du module, donc
  // on recharge la page apres l'avoir change.
  function brancherModeSwitch(wrap, cloud) {
    wrap.querySelectorAll(".mode-switch button").forEach((b) => {
      b.addEventListener("click", () => {
        const vise = b.dataset.mode;
        if ((vise === "supabase") === cloud) return; // deja dans ce mode
        try { localStorage.setItem(BACKEND_KEY, vise); } catch (e) {}
        location.reload();
      });
    });
  }

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
          ${champ("f-pass", "Mot de passe", "password", "6 caractères minimum")}
          <button class="primary block" id="go">Créer mon entreprise</button>`;
      }
      if (mode === "rejoindre") {
        return `
          ${champ("f-code", "Code de l'entreprise", "text", "Donné par votre patron")}
          ${champ("f-nom", "Votre nom", "text", "Karim B.")}
          ${champ("f-email", "Email", "email", "vous@exemple.fr")}
          ${champ("f-pass", "Mot de passe", "password", "6 caractères minimum")}
          <button class="primary block" id="go">Rejoindre l'équipe</button>`;
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
            <p class="tag">Le planning et les heures de votre équipe, sur le terrain.</p>
          </div>
          <div class="login-card">
            ${modeSwitchHTML(true)}
            <div class="seg">
              <button data-m="connexion" class="${mode === "connexion" ? "on" : ""}">Se connecter</button>
              <button data-m="creer" class="${mode === "creer" ? "on" : ""}">Nouvelle entreprise</button>
              <button data-m="rejoindre" class="${mode === "rejoindre" ? "on" : ""}">Rejoindre</button>
            </div>
            <div class="login-form">${corps()}</div>
            <div class="ia-note" id="err"></div>
          </div>
          <p class="foot">Vos données sont synchronisées et protégées par entreprise.</p>
        </div>
      `);
      wrap.querySelectorAll(".seg button").forEach((b) => {
        b.addEventListener("click", () => { mode = b.dataset.m; dessiner(); });
      });
      brancherModeSwitch(wrap, true);
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
          // "email-a-confirmer" n'est pas un echec : le compte est cree, il ne
          // manque que le clic dans l'e-mail. On l'annonce donc en vert.
          if (msg === "email-a-confirmer") {
            err.style.color = "#34d399";
            err.textContent = "Compte créé. Ouvrez l'e-mail que nous venons de vous envoyer et cliquez sur le lien : "
              + (mode === "creer" ? "votre entreprise sera créée" : "vous rejoindrez l'équipe")
              + " à votre retour. Pensez à regarder vos courriers indésirables.";
            go.disabled = true;
            go.textContent = "En attente de confirmation";
            return;
          }
          err.style.color = "";
          err.textContent = msg === "no-profile"
            ? "Ce compte n'est rattaché à aucune entreprise. Utilisez \"Rejoindre\" avec un code, ou créez une entreprise."
            : msg === "email-deja-utilise"
            ? "Cette adresse a déjà un compte. Utilisez \"Se connecter\", ou choisissez une autre adresse."
            : msg;
          go.disabled = false;
          go.textContent = mode === "creer" ? "Créer mon entreprise" : mode === "rejoindre" ? "Rejoindre l'équipe" : "Se connecter";
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
          <p class="tag">Le planning et les heures de votre équipe, sur le terrain.</p>
        </div>
        <div class="login-card">
          ${modeSwitchHTML(false)}
          <p class="login-hint">Choisissez un profil pour visiter l'application :</p>
          <div class="profils"></div>
          <button class="ghost-btn" id="reset-demo">Réinitialiser la démo</button>
        </div>
        <p class="foot">Les données de la démo restent sur cet appareil et ne partent nulle part.</p>
      </div>
    `);
    const list = wrap.querySelector(".profils");
    employes.forEach((e) => {
      const b = el(`
        <button class="profil" data-id="${e.id}">
          <span class="avatar" style="background:${e.couleur}">${esc(initiales(e.nom))}</span>
          <span class="profil-txt">
            <span class="profil-nom">${esc(e.nom)}</span>
            <span class="profil-role">${e.role === "patron" ? "Patron / gérant" : "Plombier"}</span>
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
    brancherModeSwitch(wrap, false);
    app.appendChild(wrap);
  }

  function initiales(nom) {
    return nom.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  }
  function logoSVG() {
    return '<svg viewBox="0 0 48 48" fill="none"><rect x="4" y="4" width="40" height="40" rx="11" fill="#0e1a2e" stroke="#1e3a5f"/><path d="M16 30c0-5 4-9 9-9m0 0c2.5 0 4.5 2 4.5 4.5S27.5 30 25 30m0-9V14" stroke="#38bdf8" stroke-width="2.6" stroke-linecap="round"/><circle cx="32" cy="17" r="2.6" fill="#f59e0b"/></svg>';
  }

  // Accès au socle métier sans ajouter d'onglet à la navigation principale.
  function socleBar() {
    const bar = el(`
      <div class="socle-bar" aria-label="Données de l'entreprise">
        <button data-socle="clients" class="${["clients", "client", "rapprochement"].includes(state.socleVue) ? "on" : ""}">Clients</button>
        <button data-socle="catalogue" class="${["catalogue", "article"].includes(state.socleVue) ? "on" : ""}">Catalogue</button>
        <button data-socle="devis" class="${["devis", "devisFiche"].includes(state.socleVue) ? "on" : ""}">Devis</button>
        <button data-socle="factures" class="${["factures", "factureFiche"].includes(state.socleVue) ? "on" : ""}">Factures</button>
        <button data-socle="relances" class="${state.socleVue === "relances" ? "on" : ""}">Relances</button>
      </div>`);
    bar.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      state.socleVue = b.dataset.socle;
      state.clientId = null;
      state.catalogItemId = null;
      state.devisId = null;
      state.factureId = null;
      render();
    }));
    return bar;
  }

  // ---------- Coquille (barre du haut + navigation du bas) ----------
  function shell(contenu, actions) {
    if (!state.me) return; // ignore un ancien rendu asynchrone terminé après déconnexion
    app.innerHTML = "";
    const patron = state.me.role === "patron";
    const nav = patron
      ? [ ["planning", "Planning", ICON.planning], ["equipe", "Équipe", ICON.equipe] ]
      : [ ["tournee", "Ma tournée", ICON.tournee] ];
    // Un seul onglet conserve la simplicite de ClicChantier, quel que soit
    // le nombre de modules inclus dans l'abonnement.
    if (patron && modulesActifsCharges().length) nav.push(["modules", "Modules", ICON.metier]);
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
            <button class="icon-btn" id="reglages" title="Réglages">${ICON.gear}</button>
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
      const msg = eff === "trial_expired" ? "Votre période d'essai est terminée."
        : eff === "canceled" ? "Votre abonnement est résilié."
        : eff === "unpaid" ? "Votre abonnement est impayé."
        : "Un paiement n'a pas abouti.";
      const bar = el('<div role="alert" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center;background:#7c2d12;color:#fff;padding:10px 14px;border-radius:12px;margin:8px 0;font-size:13.5px;line-height:1.4;"></div>');
      const txt = el("<span></span>");
      txt.textContent = msg + " Vos données restent consultables en lecture seule.";
      bar.appendChild(txt);
      if (patron) {
        const cta = el('<button style="background:#fff;color:#7c2d12;border:0;border-radius:9px;padding:8px 14px;font-weight:700;cursor:pointer;font-size:13.5px;">Choisir un abonnement</button>');
        cta.addEventListener("click", ouvrirAbonnementModal);
        bar.appendChild(cta);
      } else {
        const info = el("<span></span>");
        info.textContent = "Prévenez le patron pour réactiver l'accès.";
        bar.appendChild(info);
      }
      contentEl.appendChild(bar);
    }
    if (patron && state.onglet === "planning") contentEl.appendChild(socleBar());
    contentEl.appendChild(contenu);
    const tabbar = root.querySelector(".tabbar");
    nav.forEach(([id, label, icon]) => {
      const t = el(`<button class="tab ${state.onglet === id ? "on" : ""}" data-tab="${id}">${icon}<span>${label}</span></button>`);
      t.addEventListener("click", () => {
        state.onglet = id;
        if (id === "planning") state.socleVue = null;
        // Sans ceci, retaper sur « Modules » depuis l'interieur d'un module
        // reaffichait ce meme module : impossible de revenir a la liste.
        if (id === "modules") state.moduleCle = null;
        render();
      });
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
          <div class="sheet-head"><h2>Réglages</h2><button class="x" id="close">&times;</button></div>
          <div class="sheet-body">
            <div class="reg-bloc">
              <div class="reg-titre">${ICON.spark} Assistant vocal IA</div>
              <p class="reg-txt">Pour transformer les notes vocales de chantier en comptes-rendus propres, collez votre clé Groq (gratuite). Elle reste sur cet appareil, jamais envoyée ailleurs.</p>
              <label>Clé Groq<input id="f-key" type="password" placeholder="gsk_..." value="${esc(ia.getKey())}"></label>
              <p class="reg-hint">Clé gratuite sur console.groq.com (rubrique API Keys). Sans clé, la dictée marche quand même, mais sans reformulation IA.</p>
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
      ? `<div class="code-box"><span class="code-lab">Code d'invitation (à donner aux employés)</span><span class="code-val">${esc(info.code)}</span></div>`
      : "";
    blocCloud.innerHTML = `
      <div class="reg-titre">${ICON.equipe} Synchronisation</div>
      <p class="reg-txt">Mode actuel : <b>${cloud ? "Cloud (équipe synchronisée)" : "Démonstration (locale, sur cet appareil)"}</b>.</p>
      ${codeHtml}
      <button class="ghost-btn" id="switch-backend">${cloud ? "Repasser en mode démonstration" : "Activer le mode Cloud (équipe)"}</button>
      <p class="reg-hint">Le mode Cloud relie le patron et les employés en temps réel via des comptes. Le mode démonstration reste local sur l'appareil, sans compte.</p>`;
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
        const cles = MODULES_ORDRE.slice();
        const lignes = cles.map((cle) => {
          const m = MODULES_CATALOGUE[cle];
          const disponible = m.pret;
          const actif = disponible && features.actif(cle);
          return `
            <div class="mod-row ${actif ? "on" : ""} ${demo && disponible ? "demo" : ""}" ${demo && disponible ? `data-mod="${cle}"` : ""}>
              <div class="mod-txt">
                <span class="mod-nom">${esc(m.libelle)}</span>
                <span class="mod-desc">${esc(m.desc)}</span>
              </div>
              <div class="mod-etat">${!disponible
                ? '<span class="mod-badge soon">Bientôt disponible</span>'
                : actif
                ? '<span class="mod-badge ok">Inclus</span>'
                : '<span class="mod-badge lock">Non inclus</span>'}</div>
            </div>`;
        }).join("");
        const abo = fact
          ? (fact.actif ? `<span class="mod-badge ok">Actif</span>${fact.jusqu ? ` <span class="mod-desc">jusqu'au ${esc(fact.jusqu)}</span>` : ""}`
                        : '<span class="mod-badge lock">Inactif</span>')
          : '<span class="mod-desc">gérée hors ligne</span>';
        const aide = demo
          ? '<p class="reg-hint">Mode démonstration : touchez un module pour simuler son inclusion dans une formule.</p>'
          : '<p class="reg-hint">Les modules visibles sont ceux inclus dans la formule d\'abonnement de votre entreprise.</p>';
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
        <button data-vue="annee" class="${state.vue === "annee" ? "on" : ""}">Année</button>
      </div>
    `);
    bar.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => { state.vue = b.dataset.vue; render(); });
    });
    return bar;
  }

  function retourSocle(libelle, destination) {
    const b = el(`<button class="socle-back" type="button">&lsaquo; ${esc(libelle)}</button>`);
    b.addEventListener("click", () => { state.socleVue = destination; render(); });
    return b;
  }

  function prixHT(valeur) {
    return Number(valeur || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) + " HT";
  }

  // ---------- PALIER 0 : clients ----------
  async function viewClients() {
    const [clients, interventions] = await Promise.all([api.listClients(), api.listInterventions({})]);
    const aRapprocher = interventions.filter((i) => (i.client || "").trim() && !i.clientId);
    const root = el(`
      <section class="page socle-page">
        <div class="socle-head">
          <div><p class="eyebrow">Socle ClicChantier</p><h1>Clients</h1><p>Les fiches utilisées par les futurs devis et factures.</p></div>
          ${enLectureSeule() ? "" : '<button class="primary compact" id="new-client">Nouveau client</button>'}
        </div>
        <button class="reconcile-callout" id="open-reconcile">
          <span><strong>Rapprocher les chantiers existants</strong><small>${aRapprocher.length} texte${aRapprocher.length > 1 ? "s" : ""} client à vérifier manuellement</small></span>
          <span class="chev">&rsaquo;</span>
        </button>
        <div class="socle-list" id="clients-list"></div>
      </section>`);
    const list = root.querySelector("#clients-list");
    clients.forEach((client) => {
      const card = el(`
        <button class="socle-card" data-id="${client.id}">
          <span><strong>${esc(client.displayName)}</strong><small>${client.kind === "company" ? "Entreprise" : "Particulier"}${client.billingCity ? " · " + esc(client.billingCity) : ""}</small></span>
          <span class="chev">&rsaquo;</span>
        </button>`);
      card.addEventListener("click", () => { state.clientId = client.id; state.socleVue = "client"; render(); });
      list.appendChild(card);
    });
    if (!clients.length) list.appendChild(el('<p class="empty">Aucune fiche client.</p>'));
    const add = root.querySelector("#new-client");
    if (add) add.addEventListener("click", () => { state.clientId = null; state.socleVue = "client"; render(); });
    root.querySelector("#open-reconcile").addEventListener("click", () => { state.socleVue = "rapprochement"; render(); });
    return shell(root);
  }

  async function viewClientFiche(id) {
    const client = id ? await api.getClient(id) : null;
    if (id && !client) {
      montrerToast("Client introuvable.", "attente");
      state.socleVue = "clients";
      return viewClients();
    }
    const c = client || {
      kind: "individual", displayName: "", legalName: "", siren: "", vatNumber: "",
      billingAddressLine1: "", billingAddressLine2: "", billingPostalCode: "", billingCity: "",
      billingCountryCode: "FR",
    };
    const root = el(`
      <section class="page socle-page">
        <div id="client-back"></div>
        <div class="socle-head"><div><p class="eyebrow">Fiche client</p><h1>${client ? esc(client.displayName) : "Nouveau client"}</h1><p>Les champs juridiques restent vides tant qu'ils ne sont pas connus.</p></div></div>
        <form class="socle-form" id="client-form">
          <label>Type de client<select id="client-kind"><option value="individual">Particulier</option><option value="company">Entreprise</option></select></label>
          <label>Nom affiché<input id="client-display" required maxlength="200" value="${esc(c.displayName)}" placeholder="Mme Dupont ou Atelier Dupont"></label>
          <label id="legal-wrap">Raison sociale<input id="client-legal" maxlength="200" value="${esc(c.legalName)}" placeholder="Atelier Dupont SARL"></label>
          <div class="form-grid">
            <label>SIREN<input id="client-siren" inputmode="numeric" value="${esc(c.siren)}"></label>
            <label>N° de TVA<input id="client-vat" value="${esc(c.vatNumber)}"></label>
          </div>
          <label>Adresse de facturation<input id="client-address1" value="${esc(c.billingAddressLine1)}"></label>
          <label>Complément d'adresse<input id="client-address2" value="${esc(c.billingAddressLine2)}"></label>
          <div class="form-grid three">
            <label>Code postal<input id="client-postal" value="${esc(c.billingPostalCode)}"></label>
            <label>Ville<input id="client-city" value="${esc(c.billingCity)}"></label>
            <label>Pays<input id="client-country" maxlength="2" value="${esc(c.billingCountryCode)}"></label>
          </div>
          ${enLectureSeule() ? '<p class="readonly-note">Consultation en lecture seule.</p>' : '<button class="primary" type="submit">Enregistrer la fiche</button>'}
        </form>
      </section>`);
    root.querySelector("#client-back").appendChild(retourSocle("Clients", "clients"));
    const kind = root.querySelector("#client-kind");
    const legalWrap = root.querySelector("#legal-wrap");
    kind.value = c.kind;
    const afficherLegal = () => { legalWrap.hidden = kind.value !== "company"; };
    kind.addEventListener("change", afficherLegal);
    afficherLegal();
    root.querySelector("#client-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (enLectureSeule()) return;
      const payload = {
        kind: kind.value,
        displayName: root.querySelector("#client-display").value.trim(),
        legalName: root.querySelector("#client-legal").value.trim(),
        siren: root.querySelector("#client-siren").value.trim(),
        vatNumber: root.querySelector("#client-vat").value.trim(),
        billingAddressLine1: root.querySelector("#client-address1").value.trim(),
        billingAddressLine2: root.querySelector("#client-address2").value.trim(),
        billingPostalCode: root.querySelector("#client-postal").value.trim(),
        billingCity: root.querySelector("#client-city").value.trim(),
        billingCountryCode: (root.querySelector("#client-country").value.trim() || "FR").toUpperCase(),
      };
      if (!payload.displayName) return montrerToast("Le nom du client est obligatoire.", "attente");
      if (payload.kind === "company" && !payload.legalName) return montrerToast("La raison sociale est obligatoire pour une entreprise.", "attente");
      if (!/^[A-Z]{2}$/.test(payload.billingCountryCode)) return montrerToast("Le pays doit contenir deux lettres.", "attente");
      try {
        const saved = client ? await api.updateClient(client.id, payload) : await api.createClient(payload);
        state.clientId = saved.id;
        montrerToast("Fiche client enregistrée.", "ok");
        render();
      } catch (err) { montrerToast(err.message || "Enregistrement impossible.", "attente"); }
    });
    return shell(root);
  }

  // ---------- Devis (PALIER 1) ----------
  const EURO = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
  function euro(v) { return EURO.format(Number(v) || 0); }

  const DEVIS_STATUT = {
    brouillon: { libelle: "Brouillon", classe: "lock" },
    valide: { libelle: "Validé", classe: "ok" },
    envoye: { libelle: "Envoyé", classe: "ok" },
    accepte: { libelle: "Accepté", classe: "ok" },
    refuse: { libelle: "Refusé", classe: "lock" },
  };
  const CONF_LIBELLE = {
    certain: { texte: "Certain", classe: "ok" },
    probable: { texte: "Probable", classe: "" },
    a_verifier: { texte: "À vérifier", classe: "lock" },
  };
  const FACTURE_STATUT = {
    brouillon: { libelle: "Brouillon", classe: "lock" },
    valide: { libelle: "Validée", classe: "ok" },
    emise: { libelle: "Émise", classe: "ok" },
    payee: { libelle: "Payée", classe: "ok" },
    annulee: { libelle: "Annulée", classe: "lock" },
  };

  function lignesPourDocument(lignes) {
    return (lignes || []).map((ligne) => ({
      libelle: ligne.libelle || ligne.libelleSnapshot,
      description: ligne.description || ligne.descriptionSnapshot,
      unite: ligne.unite || ligne.uniteSnapshot,
      quantite: ligne.quantite,
      prixUnitaireHT: ligne.prixUnitaireHT,
      tauxTVA: ligne.tauxTVA,
    }));
  }

  async function ouvrirDocumentDevis(devis) {
    const params = await api.getParametresFacturation();
    window.Chantier.documents.ouvrir({
      titre: "Devis",
      numero: window.Chantier.documents.referenceDevis(devis),
      date: devis.createdAt,
      objet: devis.titre,
      vendeur: params.vendeurSnapshot,
      client: devis.clientSnapshot,
      lignes: lignesPourDocument(devis.lignes),
      totalHT: devis.totalHT, totalTVA: devis.totalTVA, totalTTC: devis.totalTTC,
      conditionsPaiement: params.conditionsPaiement,
      penalitesRetard: params.penalitesRetard,
      indemniteRecouvrement: params.indemniteRecouvrement,
      mentionTva: params.mentionTva,
    });
  }

  function ouvrirDocumentFacture(facture) {
    const estAvoir = facture.genre === "avoir";
    window.Chantier.documents.ouvrir({
      titre: estAvoir ? "Avoir" : "Facture",
      numero: facture.numero || "Brouillon sans numéro",
      date: facture.dateEmission || facture.createdAt,
      objet: estAvoir && facture.avoirDe ? "Correction de la facture d'origine" : "",
      vendeur: facture.vendeurSnapshot,
      client: facture.clientSnapshot,
      lignes: lignesPourDocument(facture.lignes),
      totalHT: facture.totalHT, totalTVA: facture.totalTVA, totalTTC: facture.totalTTC,
      conditionsPaiement: facture.conditionsPaiement,
      penalitesRetard: facture.penalitesRetard,
      indemniteRecouvrement: facture.indemniteRecouvrement,
      mentionTva: facture.mentionTva,
    });
  }

  // Déclaration des matériaux posés, depuis le chantier. Accessible à
  // l'employé comme au patron : c'est celui qui pose qui sait.
  async function feuilleMateriaux(intervention) {
    const [articles, emplacements, mouvements] = await Promise.all([
      api.listCatalogItems(), api.listEmplacements(),
      api.listMouvementsStock({ interventionId: intervention.id }),
    ]);
    const nomArticle = (id) => (articles.find((a) => a.id === id) || {}).label || "Article";

    const sheet = el(`
      <div class="sheet-back">
        <div class="sheet">
          <div class="sheet-head"><h2>Matériaux posés</h2><button class="x" id="close">&times;</button></div>
          <div class="sheet-body">
            <p class="reg-hint">${esc(intervention.client || "Chantier")} · ce que vous déclarez ici sera proposé à la facturation.</p>
            <form class="socle-form" id="mat-form">
              <label>Article<select name="catalogItemId" required>${articles.map((a) => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join("")}</select></label>
              <label>Emplacement d'où il sort<select name="emplacementId" required>${emplacements.map((e) => `<option value="${esc(e.id)}">${esc(e.libelle)}</option>`).join("")}</select></label>
              <label>Quantité posée<input name="quantite" type="number" min="0.01" step="0.01" value="1" required></label>
              <button class="primary" type="submit">Déclarer</button>
            </form>
            <div id="mat-liste"></div>
          </div>
        </div>
      </div>`);

    const peindre = (liste) => {
      const zone = sheet.querySelector("#mat-liste");
      zone.innerHTML = liste.length ? "<h3>Déjà déclaré</h3>" + liste.map((m) => `
        <div class="devis-ligne">
          <div class="devis-ligne-main"><strong>${esc(nomArticle(m.catalogItemId))}</strong>
            <span>${m.type === "retour" ? "Retour" : "Posé"} · ${Math.abs(Number(m.quantite))}</span></div>
        </div>`).join("") : '<p class="empty">Rien de déclaré sur ce chantier.</p>';
    };
    peindre(mouvements);

    const fermer = () => sheet.remove();
    sheet.querySelector("#close").addEventListener("click", fermer);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) fermer(); });

    const form = sheet.querySelector("#mat-form");
    if (!articles.length || !emplacements.length) {
      form.innerHTML = '<p class="empty">Ajoutez d\'abord un article au catalogue et un emplacement de stock.</p>';
    } else {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const d = new FormData(form);
        const article = articles.find((a) => a.id === d.get("catalogItemId"));
        try {
          await api.ajouterMouvementStock({
            catalogItemId: d.get("catalogItemId"),
            emplacementId: d.get("emplacementId"),
            type: "consommation",
            // Une consommation est négative : c'est du stock qui sort.
            quantite: -Math.abs(Number(d.get("quantite"))),
            prixUnitaire: article ? Number(article.purchasePriceExclTax || article.unitPriceExclTax) : null,
            interventionId: intervention.id,
            creePar: state.me.id,
          });
          peindre(await api.listMouvementsStock({ interventionId: intervention.id }));
          form.reset();
        } catch (e) { alert(e.message); }
      });
    }
    document.body.appendChild(sheet);
  }

  // ---------- La facture issue du RÉEL (PALIER 5) ----------
  // L'écran le plus important du produit : il montre l'écart entre ce qui
  // était prévu et ce qui s'est passé, et laisse l'artisan arbitrer LIGNE
  // PAR LIGNE. Rien n'est facturé sans qu'il coche.
  async function viewFactureReelle(devisId) {
    let prop;
    try {
      prop = await api.proposerFactureReelle(devisId);
    } catch (e) {
      alert(e.message);
      state.socleVue = "devisFiche";
      return render();
    }
    const r = prop.rentabilite;
    const ecartHT = prop.totalReel.ht - prop.totalDevis.ht;

    const root = el(`
      <section class="page socle-page">
        <div id="reel-back"></div>
        <div class="socle-head">
          <div><p class="eyebrow">Validation humaine</p><h1>Facturer le réel</h1>
          <p>Voici ce qui s'est passé sur le chantier. Cochez ce que vous facturez.</p></div>
        </div>
        <div class="module-kpis">
          <div class="module-kpi"><span>Devis signé</span><strong>${euro(prop.totalDevis.ht)}</strong></div>
          <div class="module-kpi ${ecartHT > 0 ? "danger" : ""}"><span>Réel facturable</span><strong>${euro(prop.totalReel.ht)}</strong></div>
          <div class="module-kpi ${r.marge < 0 ? "danger" : ""}"><span>Marge</span><strong>${euro(r.marge)}</strong></div>
        </div>
        ${prop.ecarts.length ? '<div class="module-warning">' + prop.ecarts.map((e) => esc(e.libelle)).join("<br>") + "</div>" : ""}
        <div class="module-card">
          <div class="module-card-title"><h2>Lignes proposées</h2><span>${prop.lignes.length}</span></div>
          <div id="reel-lignes"></div>
        </div>
        <div class="devis-actions" id="reel-actions"></div>
      </section>`);
    root.querySelector("#reel-back").appendChild(retourSocle("Devis", "devisFiche"));

    const zone = root.querySelector("#reel-lignes");
    if (!prop.lignes.length) {
      zone.innerHTML = '<p class="empty">Rien à facturer : aucune heure pointée ni matériau consommé sur ce chantier.</p>';
    }
    prop.lignes.forEach((l, i) => {
      const source = l.origine === "heures" ? "Heures pointées" : "Matériaux consommés";
      const ligne = el(`
        <div class="reconcile-card">
          <label class="reel-ligne">
            <input type="checkbox" checked data-i="${i}">
            <span class="reconcile-main">
              <strong>${esc(l.libelle)}</strong>
              <span>${source} · ${Number(l.quantite)} ${esc(l.unite)} × ${euro(l.prixUnitaireHT)} · TVA ${Number(l.tauxTVA)} %</span>
            </span>
            <span class="devis-ligne-total">${euro(Number(l.quantite) * Number(l.prixUnitaireHT))}</span>
          </label>
        </div>`);
      zone.appendChild(ligne);
    });

    if (prop.lignes.length) {
      const b = el('<button class="primary" type="button">Préparer la facture avec ces lignes</button>');
      b.addEventListener("click", async () => {
        const retenues = [];
        root.querySelectorAll("[data-i]").forEach((c) => {
          if (c.checked) {
            const l = prop.lignes[Number(c.dataset.i)];
            retenues.push({
              catalogItemId: l.catalogItemId, libelle: l.libelle, unite: l.unite,
              quantite: l.quantite, prixUnitaireHT: l.prixUnitaireHT, tauxTVA: l.tauxTVA,
            });
          }
        });
        if (!retenues.length) { alert("Cochez au moins une ligne."); return; }
        try {
          const facture = await api.creerFactureDepuisReel(devisId, retenues);
          state.socleVue = "factureFiche";
          state.factureId = facture.id;
          render();
        } catch (e) { alert(e.message); }
      });
      root.querySelector("#reel-actions").appendChild(b);
      root.querySelector("#reel-actions").appendChild(
        el('<p class="reg-hint">Décochez ce que vous ne facturez pas. La facture restera modifiable jusqu\'à son émission.</p>'));
    }
    return shell(root);
  }

  // ---------- Relances (PALIER 3) ----------
  const RELANCE_STATUT = {
    preparee: { libelle: "À valider", classe: "lock" },
    envoyee: { libelle: "Envoyée", classe: "ok" },
    annulee: { libelle: "Ne plus relancer", classe: "lock" },
  };

  async function viewRelances() {
    const [cibles, relances, params] = await Promise.all([
      api.ciblesARelancer(), api.listRelances(), api.getParametresRelance(),
    ]);
    const root = el(`
      <section class="page socle-page">
        <div class="socle-head">
          <div><p class="eyebrow">Socle ClicChantier</p><h1>Relances</h1>
          <p>L'appli repère ce qui traîne et rédige le message. Vous relisez, vous envoyez.</p></div>
        </div>
        <div class="module-card">
          <div class="module-card-title"><h2>À relancer</h2><span>${cibles.length}</span></div>
          <div id="rel-cibles"></div>
        </div>
        <div class="module-card">
          <div class="module-card-title"><h2>Historique</h2><span>${relances.length}</span></div>
          <div id="rel-historique"></div>
        </div>
      </section>`);

    const zoneCibles = root.querySelector("#rel-cibles");
    if (!cibles.length) {
      zoneCibles.innerHTML = '<p class="empty">Rien à relancer aujourd\'hui. Les devis sont récents et les factures à jour.</p>';
    }
    cibles.forEach((c) => {
      const estDevis = c.type === "devis";
      const titre = estDevis ? c.cible.titre : (c.cible.numero || "Facture");
      const montant = estDevis ? c.cible.totalTTC : c.reste;
      const carte = el(`
        <div class="reconcile-card">
          <div class="reconcile-main">
            <strong>${esc(titre)}</strong>
            <span>${esc((c.client && c.client.displayName) || "Client inconnu")} · ${euro(montant)}${estDevis ? " TTC" : " restant"} · ${c.joursEcoules} jours</span>
          </div>
          <div class="reconcile-actions">
            <span class="mod-badge lock">Relance ${c.niveau}</span>
            <button class="primary compact" type="button">Préparer</button>
          </div>
          <div class="rel-brouillon" hidden></div>
        </div>`);

      carte.querySelector("button").addEventListener("click", async () => {
        const zone = carte.querySelector(".rel-brouillon");
        const bouton = carte.querySelector(".reconcile-actions button");
        bouton.disabled = true;
        try {
          const prop = await window.Chantier.proposition.proposer("relance_message", {
            cible: c.type, niveau: c.niveau, ton: params.ton,
            clientNom: (c.client && c.client.displayName) || "",
            objet: estDevis ? c.cible.titre : "",
            numero: estDevis ? "" : c.cible.numero,
            montant: estDevis ? c.cible.totalTTC : 0,
            reste: estDevis ? 0 : c.reste,
            signature: "",
          });
          const conf = CONF_LIBELLE[prop.champs[0].confiance] || { texte: "", classe: "" };
          zone.hidden = false;
          zone.innerHTML = `
            <p class="reg-hint">${esc(prop.resume)} <span class="mod-badge ${conf.classe}">${conf.texte}</span></p>
            <p class="reg-hint">${esc(prop.champs[0].motif)}</p>
            <label>Adresse e-mail du client
              <input class="rel-email" type="email" autocomplete="email" placeholder="client@exemple.fr" value="${esc(c.client && c.client.email || "")}">
            </label>
            <textarea rows="7" class="rel-texte"></textarea>
            <div class="module-warning">ClicChantier n'envoie aucun message automatiquement. Le premier bouton ouvre votre messagerie. Le second enregistre seulement votre confirmation.</div>
            <div class="devis-actions">
              <button class="primary" data-ouvrir-mail type="button">Ouvrir dans ma messagerie</button>
              <button class="ghost2" data-confirmer-envoi type="button">J'ai envoyé ce message</button>
              <button class="ghost2" data-plus type="button">Ne plus relancer</button>
            </div>`;
          zone.querySelector(".rel-texte").value = prop.champs[0].valeur;

          zone.querySelector("[data-ouvrir-mail]").addEventListener("click", () => {
            const texte = zone.querySelector(".rel-texte").value;
            try {
              const destinataire = zone.querySelector(".rel-email").value;
              const reference = estDevis
                ? window.Chantier.documents.referenceDevis(c.cible)
                : (c.cible.numero || "facture");
              const objet = "Relance " + (estDevis ? "devis " : "facture ") + reference;
              location.href = window.Chantier.documents.composerMailto(destinataire, objet, texte);
            } catch (e) { alert(e.message); }
          });
          zone.querySelector("[data-confirmer-envoi]").addEventListener("click", async () => {
            const texte = zone.querySelector(".rel-texte").value;
            if (!confirm("Confirmez-vous avoir envoyé ce message depuis votre messagerie ?")) return;
            try {
              const r = await api.preparerRelance(c.type, c.cible.id, c.niveau, texte);
              await api.marquerRelanceEnvoyee(r.id, state.me.id);
              render();
            } catch (e) { alert(e.message); }
          });
          zone.querySelector("[data-plus]").addEventListener("click", async () => {
            if (!confirm("Ne plus jamais relancer ce dossier ? C'est définitif.")) return;
            try {
              const r = await api.preparerRelance(c.type, c.cible.id, c.niveau, zone.querySelector(".rel-texte").value);
              await api.annulerRelance(r.id);
              render();
            } catch (e) { alert(e.message); }
          });
        } catch (e) { alert(e.message); bouton.disabled = false; }
      });
      zoneCibles.appendChild(carte);
    });

    const zoneHisto = root.querySelector("#rel-historique");
    zoneHisto.innerHTML = relances.length ? relances.map((r) => {
      const st = RELANCE_STATUT[r.statut] || { libelle: r.statut, classe: "" };
      const quoi = r.cibleType === "devis" ? "Devis" : "Facture";
      return `<div class="devis-ligne">
        <div class="devis-ligne-main"><strong>${quoi} · relance ${r.niveau}</strong>
        <span>${esc(String(r.message).replace(/\s+/g, " ").slice(0, 90))}…</span></div>
        <div class="devis-ligne-total"><span class="mod-badge ${st.classe}">${st.libelle}</span></div>
      </div>`;
    }).join("") : '<p class="empty">Aucune relance pour l\'instant.</p>';

    return shell(root);
  }

  // ---------- Factures (PALIER 2) ----------
  async function viewFactures() {
    const [factures, clients] = await Promise.all([api.listFactures(), api.listClients()]);
    const nomClient = (id) => (clients.find((c) => c.id === id) || {}).displayName || "Client supprimé";
    const root = el(`
      <section class="page socle-page">
        <div class="socle-head">
          <div><p class="eyebrow">Socle ClicChantier</p><h1>Factures</h1>
          <p>Une facture naît d'un devis accepté, se valide, puis s'émet et devient immuable.</p></div>
        </div>
        <div class="socle-list" id="fact-list"></div>
      </section>`);

    const liste = root.querySelector("#fact-list");
    if (!factures.length) {
      liste.innerHTML = '<p class="empty">Aucune facture. Ouvrez un devis accepté pour en préparer une.</p>';
    } else {
      factures.forEach((f) => {
        const st = FACTURE_STATUT[f.statut] || { libelle: f.statut, classe: "" };
        const card = el(`
          <button class="socle-card" type="button">
            <span>
              <strong>${esc(f.numero || "Brouillon sans numéro")}</strong>
              <small>${esc(nomClient(f.clientId))} · ${euro(f.totalTTC)} TTC</small>
            </span>
            <span class="mod-badge ${st.classe}">${st.libelle}</span>
          </button>`);
        card.addEventListener("click", () => {
          state.factureId = f.id;
          state.socleVue = "factureFiche";
          render();
        });
        liste.appendChild(card);
      });
    }
    return shell(root);
  }

  // Création d'un avoir : on part des lignes de la facture, l'artisan
  // choisit ce qu'il corrige et pour quel montant.
  async function feuilleAvoir(facture) {
    const solde = await api.soldeFacture(facture.id);
    const sheet = el(`
      <div class="sheet-back">
        <div class="sheet">
          <div class="sheet-head"><h2>Corriger par un avoir</h2><button class="x" id="close">&times;</button></div>
          <div class="sheet-body">
            <p class="reg-hint">Facture ${esc(facture.numero || "")} · ${euro(solde.totalTTC)} TTC.
              ${solde.totalAvoirs > 0 ? "Déjà corrigée de " + euro(solde.totalAvoirs) + ". " : ""}
              Vous pouvez corriger au maximum <strong>${euro(solde.totalTTC - solde.totalAvoirs)}</strong>.</p>
            <form class="socle-form" id="avoir-form">
              <label>Motif de l'avoir<input name="libelle" required value="Correction de la facture ${esc(facture.numero || "")}"></label>
              <label>Montant HT à corriger €<input name="montantHT" type="number" min="0.01" step="0.01" required></label>
              <label>TVA<select name="tauxTVA">
                <option value="10">10 %</option><option value="20">20 %</option>
                <option value="5.5">5,5 %</option><option value="0">0 %</option>
              </select></label>
              <button class="primary" type="submit">Préparer l'avoir</button>
            </form>
            <p class="reg-hint">L'avoir sera préparé en brouillon. Il faudra le valider puis l'émettre, comme une facture.</p>
          </div>
        </div>
      </div>`);
    const fermer = () => sheet.remove();
    sheet.querySelector("#close").addEventListener("click", fermer);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) fermer(); });

    sheet.querySelector("#avoir-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      try {
        const avoir = await api.creerAvoir(facture.id, [{
          libelle: String(f.get("libelle")).trim(),
          unite: "forfait",
          quantite: 1,
          prixUnitaireHT: Number(f.get("montantHT")),
          tauxTVA: Number(f.get("tauxTVA")),
        }]);
        fermer();
        state.factureId = avoir.id;
        render();
      } catch (e) { alert(e.message); }
    });
    document.body.appendChild(sheet);
  }

  async function viewFactureFiche(factureId) {
    let facture = await api.getFacture(factureId);
    if (!facture) { state.socleVue = "factures"; return render(); }
    const rafraichir = async () => { facture = await api.getFacture(factureId); };

    const st = FACTURE_STATUT[facture.statut] || { libelle: facture.statut, classe: "" };
    const emise = facture.statut === "emise" || facture.statut === "payee";
    const root = el(`
      <section class="page socle-page">
        <div id="fact-back"></div>
        <div class="socle-head">
          <div><p class="eyebrow">Facture</p>
          <h1>${esc(facture.numero || "Brouillon")}</h1>
          <p>${esc(facture.clientSnapshot.nom || "")}</p></div>
          <span class="mod-badge ${st.classe}">${st.libelle}</span>
        </div>
        ${emise ? '<div class="module-warning">Cette facture est émise : elle est immuable. Une correction se fait par un avoir.</div>' : ""}
        <div class="module-card">
          <div class="module-card-title"><h2>Lignes</h2><span id="fact-nb"></span></div>
          <div class="module-list-table" id="fact-lignes"></div>
          <div class="devis-totaux" id="fact-totaux"></div>
        </div>
        <div class="module-card" id="fact-paiements-bloc" hidden>
          <div class="module-card-title"><h2>Paiements</h2><span id="fact-reste"></span></div>
          <div id="fact-paiements"></div>
        </div>
        <div class="devis-actions" id="fact-actions"></div>
      </section>`);
    root.querySelector("#fact-back").appendChild(retourSocle("Factures", "factures"));

    const peindre = () => {
      const zone = root.querySelector("#fact-lignes");
      root.querySelector("#fact-nb").textContent =
        facture.lignes.length + " ligne" + (facture.lignes.length > 1 ? "s" : "");
      zone.innerHTML = facture.lignes.map((l) => `
        <div class="devis-ligne">
          <div class="devis-ligne-main"><strong>${esc(l.libelleSnapshot)}</strong>
            <span>${Number(l.quantite)} ${esc(l.uniteSnapshot)} × ${euro(l.prixUnitaireHT)} · TVA ${Number(l.tauxTVA)} %</span></div>
          <div class="devis-ligne-total">${euro(Number(l.quantite) * Number(l.prixUnitaireHT))}</div>
        </div>`).join("") || '<p class="empty">Aucune ligne.</p>';
      root.querySelector("#fact-totaux").innerHTML = `
        <div><span>Total HT</span><strong>${euro(facture.totalHT)}</strong></div>
        <div><span>TVA</span><strong>${euro(facture.totalTVA)}</strong></div>
        <div class="devis-total-ttc"><span>Total TTC</span><strong>${euro(facture.totalTTC)}</strong></div>`;

      const blocPaiements = root.querySelector("#fact-paiements-bloc");
      if (emise) {
        blocPaiements.hidden = false;
        root.querySelector("#fact-reste").textContent = "Reste " + euro(facture.reste);
        root.querySelector("#fact-paiements").innerHTML = facture.paiements.length
          ? facture.paiements.map((p) => `<div class="devis-ligne"><div class="devis-ligne-main"><strong>${euro(p.montant)}</strong><span>${esc(p.payeLe)} · ${esc(p.moyen)}</span></div></div>`).join("")
          : '<p class="empty">Aucun paiement enregistré.</p>';
      }
    };

    const actions = root.querySelector("#fact-actions");
    const imprimer = el('<button class="ghost2" type="button">Imprimer / Enregistrer en PDF</button>');
    imprimer.addEventListener("click", () => ouvrirDocumentFacture(facture));
    actions.appendChild(imprimer);
    if (facture.statut === "brouillon") {
      const b = el('<button class="primary" type="button">Valider la facture</button>');
      b.addEventListener("click", async () => {
        if (!confirm("Valider cette facture ? Les lignes seront verrouillées.")) return;
        try { await api.changerStatutFacture(factureId, "valide", state.me.id); await rafraichir(); render(); }
        catch (e) { alert(e.message); }
      });
      actions.appendChild(b);
      actions.appendChild(el('<p class="reg-hint">La validation verrouille les lignes. Aucun numéro n\'est attribué à cette étape.</p>'));
    } else if (facture.statut === "valide") {
      const b = el('<button class="primary" type="button">Émettre la facture</button>');
      b.addEventListener("click", async () => {
        if (!confirm("Émettre définitivement cette facture ? Elle recevra son numéro et deviendra immuable.")) return;
        try { await api.emettreFacture(factureId); await rafraichir(); render(); }
        catch (e) { alert(e.message); }
      });
      actions.appendChild(b);
      const retour = el('<button class="ghost2" type="button">Revenir au brouillon</button>');
      retour.addEventListener("click", async () => {
        try { await api.changerStatutFacture(factureId, "brouillon"); await rafraichir(); render(); }
        catch (e) { alert(e.message); }
      });
      actions.appendChild(retour);
      actions.appendChild(el('<p class="reg-hint">L\'émission est définitive : le numéro est attribué et le contenu figé.</p>'));
    } else if (facture.statut === "emise") {
      const form = el(`
        <form class="socle-form" id="paiement-form">
          <label>Montant reçu €<input name="montant" type="number" min="0.01" step="0.01" required></label>
          <button class="primary" type="submit">Enregistrer le paiement</button>
        </form>`);
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        try {
          await api.enregistrerPaiement(factureId, { montant: Number(form.elements.montant.value) });
          await rafraichir(); render();
        } catch (e) { alert(e.message); }
      });
      actions.appendChild(form);
    }

    // ⭐ La seule voie de correction d'une facture émise. On ne la modifie
    // pas, on ne l'annule pas : on émet un avoir.
    if ((facture.statut === "emise" || facture.statut === "payee") && facture.genre !== "avoir") {
      const avoir = el('<button class="ghost2" type="button">Corriger par un avoir</button>');
      avoir.addEventListener("click", () => feuilleAvoir(facture));
      actions.appendChild(avoir);
      actions.appendChild(el(
        '<p class="reg-hint">Une facture émise ne se modifie pas et ne s\'annule pas. Un avoir la corrige, en tout ou en partie, et les deux documents restent.</p>'));
    }

    peindre();
    return shell(root);
  }

  async function viewDevis() {
    const [devis, clients] = await Promise.all([api.listDevis(), api.listClients()]);
    const nomClient = (id) => (clients.find((c) => c.id === id) || {}).displayName || "Client supprimé";
    const root = el(`
      <section class="page socle-page">
        <div class="socle-head">
          <div><p class="eyebrow">Socle ClicChantier</p><h1>Devis</h1>
          <p>Décrivez les travaux, l'appli propose les lignes, vous validez.</p></div>
          <button class="primary" id="devis-nouveau">Nouveau devis</button>
        </div>
        <div class="socle-list" id="devis-list"></div>
      </section>`);

    const liste = root.querySelector("#devis-list");
    if (!devis.length) {
      liste.innerHTML = '<p class="empty">Aucun devis. Créez le premier avec le bouton ci-dessus.</p>';
    } else {
      devis.forEach((d) => {
        const st = DEVIS_STATUT[d.statut] || { libelle: d.statut, classe: "" };
        const card = el(`
          <button class="socle-card" type="button">
            <span>
              <strong>${esc(d.titre)}</strong>
              <small>${esc(nomClient(d.clientId))} · ${euro(d.totalTTC)} TTC</small>
            </span>
            <span class="mod-badge ${st.classe}">${st.libelle}</span>
          </button>`);
        card.addEventListener("click", () => {
          state.devisId = d.id;
          state.socleVue = "devisFiche";
          render();
        });
        liste.appendChild(card);
      });
    }

    root.querySelector("#devis-nouveau").addEventListener("click", () => {
      if (!clients.length) {
        alert("Créez d'abord une fiche client dans l'écran Clients.");
        return;
      }
      const form = el(`
        <form class="socle-form" id="devis-form">
          <label>Titre du devis<input name="titre" required placeholder="Rénovation salle de bain"></label>
          <label>Client<select name="clientId" required>${
            clients.map((c) => `<option value="${esc(c.id)}">${esc(c.displayName)}</option>`).join("")
          }</select></label>
          <button class="primary" type="submit">Créer le brouillon</button>
        </form>`);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        try {
          const cree = await api.createDevis({
            titre: String(data.get("titre") || ""),
            clientId: String(data.get("clientId") || ""),
          });
          state.devisId = cree.id;
          state.socleVue = "devisFiche";
          render();
        } catch (e) { alert(e.message); }
      });
      root.querySelector("#devis-nouveau").replaceWith(form);
    });

    return shell(root);
  }

  async function viewDevisFiche(devisId) {
    const devis = await api.getDevis(devisId);
    if (!devis) { state.socleVue = "devis"; return render(); }
    const brouillon = devis.statut === "brouillon";
    const st = DEVIS_STATUT[devis.statut] || { libelle: devis.statut, classe: "" };

    const root = el(`
      <section class="page socle-page">
        <div id="devis-back"></div>
        <div class="socle-head">
          <div><p class="eyebrow">Devis</p><h1>${esc(devis.titre)}</h1>
          <p>${esc((devis.clientSnapshot && devis.clientSnapshot.displayName) || "")}</p></div>
          <span class="mod-badge ${st.classe}">${st.libelle}</span>
        </div>
        <div id="devis-ia"></div>
        <div class="socle-card-bloc">
          <div class="module-card-title"><h2>Lignes</h2><span id="devis-nb"></span></div>
          <div id="devis-lignes"></div>
        </div>
        <div class="devis-totaux" id="devis-totaux"></div>
        <div class="devis-actions" id="devis-actions"></div>
      </section>`);
    root.querySelector("#devis-back").appendChild(retourSocle("Devis", "devis"));

    const peindreTotaux = () => {
      root.querySelector("#devis-totaux").innerHTML = `
        <div><span>Total HT</span><strong>${euro(devis.totalHT)}</strong></div>
        <div><span>TVA</span><strong>${euro(devis.totalTVA)}</strong></div>
        <div class="grand"><span>Total TTC</span><strong>${euro(devis.totalTTC)}</strong></div>`;
    };

    const peindreLignes = () => {
      const box = root.querySelector("#devis-lignes");
      root.querySelector("#devis-nb").textContent =
        devis.lignes.length + " ligne" + (devis.lignes.length > 1 ? "s" : "");
      if (!devis.lignes.length) {
        box.innerHTML = '<p class="empty">Aucune ligne. Décrivez les travaux ci-dessus ou ajoutez-les à la main.</p>';
        return;
      }
      box.innerHTML = devis.lignes.map((l) => `
        <div class="devis-ligne" data-ligne="${esc(l.id)}">
          <div class="devis-ligne-main">
            <strong>${esc(l.libelleSnapshot)}</strong>
            ${l.descriptionSnapshot ? `<small>${esc(l.descriptionSnapshot)}</small>` : ""}
            ${l.catalogItemId ? "" : '<small class="hors-catalogue">Hors catalogue, saisi à la main</small>'}
          </div>
          <div class="devis-ligne-chiffres">
            <span>${Number(l.quantite)} ${esc(l.uniteSnapshot)} × ${euro(l.prixUnitaireHT)}</span>
            <strong>${euro(Number(l.quantite) * Number(l.prixUnitaireHT))}</strong>
            <small>TVA ${Number(l.tauxTVA)} %</small>
          </div>
          ${brouillon ? '<button class="danger-text" type="button" data-suppr>Retirer</button>' : ""}
        </div>`).join("");
      box.querySelectorAll("[data-suppr]").forEach((b) => {
        b.addEventListener("click", async () => {
          try {
            await api.deleteDevisLigne(b.closest("[data-ligne]").dataset.ligne);
            await rafraichir();
          } catch (e) { alert(e.message); }
        });
      });
    };

    async function rafraichir() {
      const frais = await api.getDevis(devisId);
      devis.lignes = frais.lignes;
      devis.totalHT = frais.totalHT;
      devis.totalTVA = frais.totalTVA;
      devis.totalTTC = frais.totalTTC;
      devis.statut = frais.statut;
      peindreLignes();
      peindreTotaux();
    }

    // --- Assistant : il PROPOSE, l'humain valide. Rien n'est écrit avant le clic.
    if (brouillon) {
      const catalogue = await api.listCatalogItems();
      const bloc = el(`
        <div class="socle-card-bloc ia-bloc">
          <div class="module-card-title"><h2>Décrire les travaux</h2>
            <span class="mod-badge">Proposition, vous validez</span></div>
          <textarea id="ia-texte" rows="3" placeholder="Ex : diagnostic de la fuite, puis pose de 2 robinetteries"></textarea>
          <button class="primary" id="ia-proposer" type="button">Proposer les lignes</button>
          <div id="ia-sortie"></div>
        </div>`);
      const sortie = bloc.querySelector("#ia-sortie");

      bloc.querySelector("#ia-proposer").addEventListener("click", async () => {
        sortie.innerHTML = '<p class="reg-hint">Analyse en cours…</p>';
        const res = await window.Chantier.proposition.proposer("devis_lignes", {
          texte: bloc.querySelector("#ia-texte").value,
          catalogue,
        });
        if (res.question) {
          sortie.innerHTML = `<p class="ia-question">${esc(res.question)}</p>`;
          return;
        }
        const rendu = el(`
          <div class="ia-proposition">
            <p class="ia-resume">${esc(res.resume)}</p>
            <div class="ia-lignes">${res.champs.map((c, i) => {
              const conf = CONF_LIBELLE[c.confiance] || { texte: c.confiance, classe: "" };
              return `<label class="ia-ligne">
                <input type="checkbox" data-i="${i}" checked>
                <span class="ia-ligne-txt"><strong>${esc(c.libelle)}</strong>
                <small>${Number(c.quantite)} ${esc(c.unite)} × ${euro(c.prixUnitaireHT)} · TVA ${c.tauxTVA} %</small>
                <small class="ia-motif">${esc(c.motif)}</small></span>
                <span class="mod-badge ${conf.classe}">${conf.texte}</span>
              </label>`;
            }).join("")}</div>
            <div class="ia-actions">
              <button class="ghost2" type="button" id="ia-annuler">Annuler</button>
              <button class="primary" type="button" id="ia-ajouter">Ajouter les lignes cochées</button>
            </div>
          </div>`);
        sortie.innerHTML = "";
        sortie.appendChild(rendu);

        rendu.querySelector("#ia-annuler").addEventListener("click", () => { sortie.innerHTML = ""; });
        rendu.querySelector("#ia-ajouter").addEventListener("click", async () => {
          const choisies = [...rendu.querySelectorAll("input[type=checkbox]")]
            .filter((cb) => cb.checked)
            .map((cb) => res.champs[Number(cb.dataset.i)]);
          try {
            for (const c of choisies) {
              await api.addDevisLigne(devisId, {
                catalogItemId: c.catalogItemId,
                libelle: c.libelle,
                description: c.description,
                unite: c.unite,
                quantite: c.quantite,
                prixUnitaireHT: c.prixUnitaireHT,
                tauxTVA: c.tauxTVA,
              });
            }
            sortie.innerHTML = "";
            bloc.querySelector("#ia-texte").value = "";
            await rafraichir();
          } catch (e) { alert(e.message); }
        });
      });

      // Saisie manuelle, toujours disponible : l'IA n'est jamais un passage obligé.
      // Le taux horaire de l'entreprise est LA reference du prix de l'heure :
      // il sert au module Rentabilite et a la facture depuis le reel. Si un
      // devis vend l'heure a un autre prix, la comparaison devis / reel
      // devient incomprehensible. On le propose donc directement ici.
      const paramsFact = await api.getParametresFacturation();
      const tauxHoraire = Number(paramsFact && paramsFact.tauxHoraireVente) || 0;
      const tvaMO = Number(paramsFact && paramsFact.tvaMainOeuvre) || 10;
      const manuel = el(`
        <form class="socle-form devis-manuel">
          ${tauxHoraire > 0 ? `<button class="ghost2 mo-raccourci" type="button" id="mo-raccourci">
            + Main d’œuvre au taux de l’entreprise (${euro(tauxHoraire)} / h)</button>` : ""}
          <label>Désignation<input name="libelle" required></label>
          <label>Unité<input name="unite" value="u" required></label>
          <label>Quantité<input name="quantite" type="number" min="0.01" step="0.01" value="1" required></label>
          <label>Prix unitaire HT<input name="prix" type="number" min="0" step="0.01" value="0" required></label>
          <label>TVA<select name="tva"><option>10</option><option>20</option><option>5.5</option><option>0</option></select></label>
          <button class="ghost2" type="submit">Ajouter à la main</button>
        </form>`);

      // Raccourci : une ligne de main d'oeuvre prete a completer.
      const raccourci = manuel.querySelector("#mo-raccourci");
      if (raccourci) {
        raccourci.addEventListener("click", () => {
          manuel.elements.libelle.value = manuel.elements.libelle.value || "Main d’œuvre";
          manuel.elements.unite.value = "h";
          manuel.elements.prix.value = tauxHoraire;
          manuel.elements.tva.value = String(tvaMO);
          manuel.elements.quantite.focus();
        });
      }

      // Passer l'unite a l'heure suffit : le prix se cale sur le taux horaire
      // tant que l'artisan n'a rien saisi lui-meme. On n'ecrase jamais un prix
      // deja tape.
      manuel.elements.unite.addEventListener("change", () => {
        const unite = String(manuel.elements.unite.value || "").trim().toLowerCase();
        const estHeure = unite === "h" || unite === "hh" || unite === "heure" || unite === "heures";
        if (estHeure && tauxHoraire > 0 && Number(manuel.elements.prix.value) === 0) {
          manuel.elements.prix.value = tauxHoraire;
          manuel.elements.tva.value = String(tvaMO);
        }
      });
      manuel.addEventListener("submit", async (event) => {
        event.preventDefault();
        const d = new FormData(manuel);
        try {
          await api.addDevisLigne(devisId, {
            catalogItemId: null,
            libelle: String(d.get("libelle") || ""),
            description: "",
            unite: String(d.get("unite") || "u"),
            quantite: Number(d.get("quantite")),
            prixUnitaireHT: Number(d.get("prix")),
            tauxTVA: Number(d.get("tva")),
          });
          manuel.reset();
          manuel.elements.unite.value = "u";
          await rafraichir();
        } catch (e) { alert(e.message); }
      });
      bloc.appendChild(manuel);
      root.querySelector("#devis-ia").appendChild(bloc);
    }

    // --- Actions de cycle de vie, chacune est un clic humain explicite.
    const actions = root.querySelector("#devis-actions");
    const imprimer = el('<button class="ghost2" type="button">Imprimer / Enregistrer en PDF</button>');
    imprimer.addEventListener("click", async () => {
      try { await ouvrirDocumentDevis(devis); }
      catch (e) { alert(e.message); }
    });
    actions.appendChild(imprimer);
    const bouton = (libelle, classe, statut, confirmation) => {
      const b = el(`<button class="${classe}" type="button">${esc(libelle)}</button>`);
      b.addEventListener("click", async () => {
        if (confirmation && !confirm(confirmation)) return;
        try {
          await api.changerStatutDevis(devisId, statut, state.me.id);
          await rafraichir();
          render();
        } catch (e) { alert(e.message); }
      });
      return b;
    };

    if (devis.statut === "brouillon") {
      actions.appendChild(bouton("Valider le devis", "primary", "valide",
        "Valider ce devis ? Les lignes seront verrouillées."));
      actions.appendChild(el('<p class="reg-hint">La validation verrouille les lignes. Rien n\'est envoyé au client à cette étape.</p>'));
    } else if (devis.statut === "valide") {
      actions.appendChild(bouton("Marquer comme envoyé", "primary", "envoye",
        "Confirmez-vous avoir envoyé ce devis au client ?"));
      actions.appendChild(bouton("Revenir au brouillon", "ghost2", "brouillon"));
    } else if (devis.statut === "envoye") {
      actions.appendChild(bouton("Le client a accepté", "primary", "accepte"));
      actions.appendChild(bouton("Le client a refusé", "ghost2", "refuse"));
    } else if (devis.statut === "accepte") {
      // Le devis accepté devient une facture. Les lignes sont recopiées,
      // le devis reste intact.
      const versFacture = el('<button class="primary" type="button">Préparer la facture</button>');
      versFacture.addEventListener("click", async () => {
        try {
          const facture = await api.creerFactureDepuisDevis(devisId);
          state.socleVue = "factureFiche";
          state.factureId = facture.id;
          render();
        } catch (e) { alert(e.message); }
      });
      actions.appendChild(versFacture);

      // ⭐ Le cœur du produit : facturer ce qui s'est VRAIMENT passé.
      const versReel = el('<button class="primary" type="button">Facturer depuis le réel</button>');
      versReel.addEventListener("click", async () => {
        state.socleVue = "factureReelle";
        state.devisId = devisId;
        render();
      });
      actions.appendChild(versReel);
      actions.appendChild(el('<p class="reg-hint">« Depuis le devis » recopie ce qui était prévu. « Depuis le réel » part des heures pointées et des matériaux consommés, et vous signale les écarts.</p>'));
    }

    peindreLignes();
    peindreTotaux();
    return shell(root);
  }

  async function viewRapprochementClients() {
    const [clients, interventions] = await Promise.all([api.listClients(), api.listInterventions({})]);
    const aRapprocher = interventions.filter((i) => (i.client || "").trim() && !i.clientId);
    const root = el(`
      <section class="page socle-page">
        <div id="reconcile-back"></div>
        <div class="socle-head"><div><p class="eyebrow">Validation humaine</p><h1>Rapprochement</h1><p>Choisissez explicitement une fiche pour chaque texte historique. Aucun choix n'est prérempli.</p></div></div>
        <div class="socle-list" id="reconcile-list"></div>
      </section>`);
    root.querySelector("#reconcile-back").appendChild(retourSocle("Clients", "clients"));
    const list = root.querySelector("#reconcile-list");
    aRapprocher.forEach((intervention) => {
      const card = el(`
        <div class="reconcile-card">
          <div><strong>${esc(intervention.client)}</strong><small>${esc(intervention.date)} · ${esc(intervention.adresse || "Adresse non renseignée")}</small></div>
          <div class="reconcile-actions">
            <select aria-label="Fiche client pour ${esc(intervention.client)}"><option value="">Choisir une fiche…</option></select>
            <button class="primary compact" type="button" disabled>Rattacher</button>
          </div>
        </div>`);
      const select = card.querySelector("select");
      clients.forEach((client) => {
        const option = document.createElement("option");
        option.value = client.id;
        option.textContent = client.displayName;
        select.appendChild(option);
      });
      const bouton = card.querySelector("button");
      select.addEventListener("change", () => { bouton.disabled = !select.value || enLectureSeule(); });
      bouton.addEventListener("click", async () => {
        if (!select.value || enLectureSeule()) return;
        try {
          await api.linkInterventionClient(intervention.id, select.value);
          montrerToast("Chantier rattaché après validation.", "ok");
          render();
        } catch (err) { montrerToast(err.message || "Rapprochement impossible.", "attente"); }
      });
      list.appendChild(card);
    });
    if (!aRapprocher.length) list.appendChild(el('<p class="empty">Tous les textes client ont été vérifiés.</p>'));
    return shell(root);
  }

  // ---------- PALIER 0 : catalogue ----------
  async function viewCatalogue() {
    const [categories, items] = await Promise.all([api.listCatalogCategories(), api.listCatalogItems()]);
    const categoriesParId = Object.fromEntries(categories.map((c) => [c.id, c.label]));
    const root = el(`
      <section class="page socle-page">
        <div class="socle-head">
          <div><p class="eyebrow">Socle ClicChantier</p><h1>Catalogue</h1><p>Prestations et matériaux réutilisables dans les futurs devis.</p></div>
          ${enLectureSeule() ? "" : '<button class="primary compact" id="new-item">Nouvel article</button>'}
        </div>
        ${enLectureSeule() ? "" : '<form class="category-form" id="category-form"><input id="category-label" maxlength="120" placeholder="Nouvelle catégorie"><button type="submit">Ajouter</button></form>'}
        <div class="category-chips" id="category-chips"></div>
        <div class="socle-list" id="catalog-list"></div>
      </section>`);
    const chips = root.querySelector("#category-chips");
    categories.forEach((category) => chips.appendChild(el(`<span>${esc(category.label)}</span>`)));
    const list = root.querySelector("#catalog-list");
    items.forEach((item) => {
      const card = el(`
        <button class="socle-card catalog-card" data-id="${item.id}">
          <span><strong>${esc(item.label)}</strong><small>${item.kind === "service" ? "Prestation" : "Matériau"}${item.categoryId ? " · " + esc(categoriesParId[item.categoryId] || "Catégorie archivée") : ""}</small></span>
          <span class="catalog-price">${esc(prixHT(item.unitPriceExclTax))}<small>par ${esc(item.unit)}</small></span>
        </button>`);
      card.addEventListener("click", () => { state.catalogItemId = item.id; state.socleVue = "article"; render(); });
      list.appendChild(card);
    });
    if (!items.length) list.appendChild(el('<p class="empty">Aucune prestation dans le catalogue.</p>'));
    const add = root.querySelector("#new-item");
    if (add) add.addEventListener("click", () => { state.catalogItemId = null; state.socleVue = "article"; render(); });
    const categoryForm = root.querySelector("#category-form");
    if (categoryForm) categoryForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const label = root.querySelector("#category-label").value.trim();
      if (!label) return montrerToast("Le nom de la catégorie est obligatoire.", "attente");
      try { await api.createCatalogCategory({ label }); montrerToast("Catégorie ajoutée.", "ok"); render(); }
      catch (err) { montrerToast(err.message || "Ajout impossible.", "attente"); }
    });
    return shell(root);
  }

  async function viewCatalogItem(id) {
    const [item, categories] = await Promise.all([
      id ? api.getCatalogItem(id) : Promise.resolve(null),
      api.listCatalogCategories(),
    ]);
    if (id && !item) {
      montrerToast("Article introuvable.", "attente");
      state.socleVue = "catalogue";
      return viewCatalogue();
    }
    const i = item || {
      categoryId: null, kind: "service", reference: "", label: "", description: "",
      unit: "u", unitPriceExclTax: 0, vatRate: 20, purchasePriceExclTax: null,
    };
    const options = categories.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("");
    const root = el(`
      <section class="page socle-page">
        <div id="catalog-back"></div>
        <div class="socle-head"><div><p class="eyebrow">Article de catalogue</p><h1>${item ? esc(item.label) : "Nouvel article"}</h1><p>Les montants sont enregistrés hors taxes.</p></div></div>
        <form class="socle-form" id="item-form">
          <div class="form-grid">
            <label>Type<select id="item-kind"><option value="service">Prestation</option><option value="material">Matériau</option></select></label>
            <label>Catégorie<select id="item-category"><option value="">Sans catégorie</option>${options}</select></label>
          </div>
          <div class="form-grid">
            <label>Référence<input id="item-reference" maxlength="80" value="${esc(i.reference)}" placeholder="DEP-DIAG"></label>
            <label>Unité<input id="item-unit" required maxlength="30" value="${esc(i.unit)}" placeholder="u, h, forfait"></label>
          </div>
          <label>Libellé<input id="item-label" required maxlength="300" value="${esc(i.label)}"></label>
          <label>Description<textarea id="item-description" rows="3">${esc(i.description)}</textarea></label>
          <div class="form-grid three">
            <label>Prix de vente HT<input id="item-price" type="number" min="0" step="0.01" value="${esc(i.unitPriceExclTax)}"></label>
            <label>TVA (%)<input id="item-vat" type="number" min="0" max="100" step="0.01" value="${esc(i.vatRate)}"></label>
            <label>Coût d'achat HT<input id="item-purchase" type="number" min="0" step="0.01" value="${i.purchasePriceExclTax == null ? "" : esc(i.purchasePriceExclTax)}"></label>
          </div>
          ${enLectureSeule() ? '<p class="readonly-note">Consultation en lecture seule.</p>' : '<button class="primary" type="submit">Enregistrer l\'article</button>'}
        </form>
      </section>`);
    root.querySelector("#catalog-back").appendChild(retourSocle("Catalogue", "catalogue"));
    root.querySelector("#item-kind").value = i.kind;
    root.querySelector("#item-category").value = i.categoryId || "";
    root.querySelector("#item-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (enLectureSeule()) return;
      const prix = Number(root.querySelector("#item-price").value);
      const tva = Number(root.querySelector("#item-vat").value);
      const achatTexte = root.querySelector("#item-purchase").value;
      const payload = {
        kind: root.querySelector("#item-kind").value,
        categoryId: root.querySelector("#item-category").value || null,
        reference: root.querySelector("#item-reference").value.trim(),
        unit: root.querySelector("#item-unit").value.trim(),
        label: root.querySelector("#item-label").value.trim(),
        description: root.querySelector("#item-description").value.trim(),
        unitPriceExclTax: prix,
        vatRate: tva,
        purchasePriceExclTax: achatTexte === "" ? null : Number(achatTexte),
      };
      if (!payload.label || !payload.unit) return montrerToast("Le libellé et l'unité sont obligatoires.", "attente");
      if (!Number.isFinite(prix) || prix < 0) return montrerToast("Le prix de vente doit être positif ou nul.", "attente");
      if (!Number.isFinite(tva) || tva < 0 || tva > 100) return montrerToast("Le taux de TVA doit être compris entre 0 et 100.", "attente");
      if (payload.purchasePriceExclTax != null && (!Number.isFinite(payload.purchasePriceExclTax) || payload.purchasePriceExclTax < 0)) return montrerToast("Le coût d'achat doit être positif ou nul.", "attente");
      if (payload.reference) {
        const items = await api.listCatalogItems();
        const duplicate = items.find((x) => x.id !== (item && item.id) && (x.reference || "").toLowerCase() === payload.reference.toLowerCase());
        if (duplicate) return montrerToast("Cette référence existe déjà.", "attente");
      }
      try {
        const saved = item ? await api.updateCatalogItem(item.id, payload) : await api.createCatalogItem(payload);
        state.catalogItemId = saved.id;
        montrerToast("Article de catalogue enregistré.", "ok");
        render();
      } catch (err) { montrerToast(err.message || "Enregistrement impossible.", "attente"); }
    });
    return shell(root);
  }

  // ---------- Vue PATRON : planning (agenda avec zoom) ----------
  async function viewPlanning() {
    if (state.socleVue === "clients") return viewClients();
    if (state.socleVue === "client") return viewClientFiche(state.clientId);
    if (state.socleVue === "catalogue") return viewCatalogue();
    if (state.socleVue === "article") return viewCatalogItem(state.catalogItemId);
    if (state.socleVue === "rapprochement") return viewRapprochementClients();
    if (state.socleVue === "devis") return viewDevis();
    if (state.socleVue === "devisFiche") return viewDevisFiche(state.devisId);
    if (state.socleVue === "factures") return viewFactures();
    if (state.socleVue === "factureFiche") return viewFactureFiche(state.factureId);
    if (state.socleVue === "relances") return viewRelances();
    if (state.socleVue === "factureReelle") return viewFactureReelle(state.devisId);
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
      cont.appendChild(el(`<div class="empty">Aucune intervention prévue ce jour.<br><span>Touchez + pour en ajouter une.</span></div>`));
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
          <button class="icon-btn" id="reglages2" title="Réglages">${ICON.gear}</button>
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
          <textarea id="cmd-txt" rows="2" placeholder="Ex : déplace le chantier de Mme Roux à mardi prochain et donne-le à Lucas"></textarea>
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
        micBtn.classList.add("on"); micLab.textContent = "J'écoute... (toucher pour stopper)";
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
        jourBox.appendChild(el(`<div class="asst-jour-vide">Journée libre.</div>`));
      }
    }

    // Commande IA
    root.querySelector("#demander").addEventListener("click", async () => {
      const commande = txt.value.trim();
      propo.innerHTML = "";
      if (!commande) { iaNote.textContent = "Écrivez ou dictez votre demande."; return; }
      if (!ia.aKey()) { iaNote.textContent = "Ajoutez votre clé IA (Groq) dans les Réglages (roue crantée)."; return; }
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
          ? "Ajoutez votre clé IA dans les Réglages."
          : "IA indisponible (" + e.message + ").";
      } finally { btn.disabled = false; }
    });

    function afficherProposition(r) {
      const ch = (r.changements || {});
      const rien = !ch.date && !ch.dateFin && !ch.employeId;
      if (!r.chantierId || rien || r.question) {
        propo.innerHTML = `<div class="propo q">${ICON.spark}<span>${esc(r.question || "Je n'ai pas trouvé le chantier concerné. Reformulez en précisant le client.")}</span></div>`;
        return;
      }
      propo.innerHTML = `
        <div class="propo">
          <div class="propo-titre">Action proposée</div>
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
        <div class="dateinfo"><b>${an}</b><span>${inters.length} chantier${inters.length > 1 ? "s" : ""} dans l'année</span></div>
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
            <span class="assig"><span class="dot" style="background:${couleurEmploye(it.employeId)}"></span>${it.employeId ? esc(nomEmploye(it.employeId)) : "Non assigné"}</span>
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
              <textarea id="note-txt" rows="4" placeholder="${vocalDispo ? "Appuyez sur Dicter et parlez, ou écrivez ici..." : "Écrivez votre note de suivi ici..."}"></textarea>
              <div class="composer-actions">
                <button class="act-btn ia-btn" id="reformuler">${ICON.spark}Améliorer avec l'IA</button>
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
        micBtn.classList.add("on"); micLab.textContent = "J'écoute... (toucher pour stopper)";
        iaNote.textContent = "";
        dicteur.demarrer();
      });
    }

    // Reformulation IA
    sheet.querySelector("#reformuler").addEventListener("click", async () => {
      const brut = txt.value.trim();
      if (!brut) { iaNote.textContent = "Dictez ou écrivez d'abord une note."; return; }
      if (!ia.aKey()) { iaNote.innerHTML = 'Ajoutez votre clé IA (Groq) dans les Réglages (roue crantée en haut).'; return; }
      if (ecoute && dicteur) dicteur.arreter();
      const btn = sheet.querySelector("#reformuler");
      btn.disabled = true; iaNote.textContent = "L'IA reformule votre note...";
      try {
        const propre = await ia.reformuler(brut, it.client + " - " + it.description);
        if (propre) { brutMemo = brut; txt.value = propre; parIA = true; iaNote.textContent = "Reformulé par l'IA. Vous pouvez corriger avant d'enregistrer."; }
        else iaNote.textContent = "L'IA n'a rien renvoyé, gardez votre note.";
      } catch (e) {
        iaNote.textContent = String(e.message).startsWith("no-key")
          ? "Ajoutez votre clé IA dans les Réglages."
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
      : `<div class="jour-vide">Aucune heure pointée pour l'instant.</div>`;
    const notes = await api.listJournal(id);
    const lignesNotes = notes.length
      ? notes.map((n) => ligneNote(n, id, false)).join("")
      : `<div class="jour-vide">Aucun suivi de chantier envoyé par l'équipe.</div>`;
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
              <div class="det-line"><span class="dot" style="background:${couleurEmploye(it.employeId)}"></span><span>${it.employeId ? esc(nomEmploye(it.employeId)) : "Non assigné"}</span> ${badgeStatut(it.statut)}</div>
            </div>
            <div class="det-desc">${esc(it.description)}</div>
            <div class="total-box">
              <span class="lab">Total des heures pointées</span>
              <span class="total-big">${totalMs > 0 ? dureeStr(totalMs) : "0h00"}</span>
            </div>
            <div class="jours-title">Détail par jour</div>
            <div class="jours-list">${lignesJours}</div>
            <div class="jours-title">${ICON.note} Suivi du chantier</div>
            <div class="jours-list">${lignesNotes}</div>
          </div>
          <div class="sheet-foot">
            <button class="danger" id="edit">Modifier</button>
            ${estLong(it) ? (it.statut === "termine"
              ? '<button class="ghost2" id="reopen">Rouvrir le chantier</button>'
              : '<button class="primary" id="done">Chantier terminé</button>') : "<span></span>"}
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
      a_faire: ["À faire", "b-todo"],
      en_cours: ["En cours", "b-run"],
      termine: ["Terminé", "b-done"],
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
            <label>Téléphone<input id="f-tel" type="tel" value="${esc(data.tel)}" placeholder="06 ..."></label>
            <div class="row2">
              <label>Début<input id="f-date" type="date" value="${esc(data.date)}"></label>
              <label>Heure<input id="f-heure" type="time" value="${esc(data.heure)}"></label>
            </div>
            <label>Fin du chantier <span class="opt">(si plusieurs jours, sinon laissez vide)</span><input id="f-datefin" type="date" value="${esc(data.dateFin && data.dateFin !== data.date ? data.dateFin : "")}"></label>
            <label>Assigner à<select id="f-employe"><option value="">Non assigné</option>${opts}</select></label>
            <label>Travail à faire<textarea id="f-desc" rows="3" placeholder="Ex : fuite sous évier, remplacer le siphon">${esc(data.description)}</textarea></label>
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
      if (dFin && dFin < dDebut) { alert("La date de fin doit être après le début."); return; }
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
        <div class="dateinfo"><b>${fmtDateFR(state.date)}</b><span>Heures de l'équipe</span></div>
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
        <div class="dateinfo"><b>${fmtDateFR(state.date)}</b><span>${state.date === todayISO() ? "Ma tournée du jour" : "Ma tournée"}</span></div>
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
    // ⭐ Matériaux posés : c'est CE geste, fait sur le chantier, qui rendra
    // la facture réelle possible. Sans lui, le palier 5 ne sert à rien.
    const materiaux = el(`<button class="act-btn">${ICON.note}Matériaux</button>`);
    materiaux.addEventListener("click", () => feuilleMateriaux(it));
    zone.appendChild(materiaux);
    // Pointage
    if (it.statut === "termine" && !actif) {
      zone.appendChild(el(`<span class="done-tag">Chantier terminé</span>`));
    } else if (actif) {
      const stop = el(`<button class="act-btn stop">${long ? "Arrêter ma journée" : "Terminer"}</button>`);
      stop.addEventListener("click", async () => {
        await api.terminerPointage(ptEnCours.id);
        render();
      });
      zone.appendChild(stop);
    } else {
      const start = el(`<button class="act-btn go">${long ? "Démarrer ma journée" : "Démarrer"}</button>`);
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

  // ---------- Espace Modules ----------
  async function viewModules() {
    const actives = modulesActifsCharges();
    if (state.moduleCle && actives.indexOf(state.moduleCle) !== -1) {
      const contenu = await window.Chantier[state.moduleCle].page();
      const vue = el('<div class="module-vue"></div>');
      vue.appendChild(contenu);
      // Certains modules (ceux de la gestion) posent deja leur propre retour :
      // on n'en ajoute un que la ou il manque, sinon il apparait en double.
      if (!vue.querySelector("[data-retour]")) {
        const retour = el('<button class="socle-back" type="button">&lsaquo; Modules</button>');
        retour.addEventListener("click", () => { state.moduleCle = null; render(); });
        vue.insertBefore(retour, vue.firstChild);
      }
      return shell(vue);
    }
    state.moduleCle = null;
    const wrap = el(`
      <section class="modules-home">
        <div class="page-title">
          <div><p class="eyebrow">ClicChantier</p><h1>Modules</h1>
          <p>Les outils inclus dans la formule de votre entreprise.</p></div>
        </div>
        <div class="modules-grid"></div>
      </section>`);
    const grid = wrap.querySelector(".modules-grid");
    actives.forEach((cle) => {
      const module = MODULES_CATALOGUE[cle];
      const card = el(`
        <button class="module-tile" data-module="${cle}">
          <span class="module-tile-icon">${ICON.metier}</span>
          <span><strong>${esc(module.libelle)}</strong><small>${esc(module.desc)}</small></span>
          <span class="chev">&rsaquo;</span>
        </button>`);
      card.addEventListener("click", () => {
        state.moduleCle = cle;
        if (window.Chantier[cle].reset) window.Chantier[cle].reset();
        render();
      });
      grid.appendChild(card);
    });
    if (!actives.length) grid.innerHTML = '<p class="empty">Aucun module inclus dans cette formule.</p>';
    return shell(wrap);
  }

  // ---------- Routeur ----------
  function messageErreurUtilisateur(error) {
    const message = String(error && error.message || error || "").trim();
    if (/Failed to fetch|NetworkError|Load failed|ERR_INTERNET|hors ligne/i.test(message)) {
      return "ClicChantier ne parvient pas à joindre la base en ligne. Vérifiez votre connexion, puis réessayez.";
    }
    if (/column .* does not exist|schema cache|relation .* does not exist|PGRST\d+/i.test(message)) {
      return "La base en ligne doit être mise à jour avant de pouvoir utiliser cette partie de ClicChantier. Aucune donnée n'a été modifiée.";
    }
    return message || "ClicChantier n'a pas pu charger vos données. Réessayez dans quelques instants.";
  }

  function afficherErreurGlobale(error) {
    if (console && console.error) console.error("Erreur ClicChantier :", error);
    const message = messageErreurUtilisateur(error);
    const wrap = el(`
      <div class="login erreur-globale" role="alert">
        <div class="brand">
          <div class="logo">${logoSVG()}</div>
          <h1>ClicChantier</h1>
        </div>
        <div class="login-card">
          <h2>Impossible de charger vos données</h2>
          <p class="login-hint">${esc(message)}</p>
          <button class="primary block" id="reessayer" type="button">Réessayer</button>
          ${api.estCloud && state.me ? '<button class="ghost-btn block" id="changer-compte" type="button">Changer de compte</button>' : ""}
          <p class="mode-hint">Si le problème continue, notez ce message et contactez l'assistance. Ne recréez pas vos données.</p>
        </div>
      </div>`);
    wrap.querySelector("#reessayer").addEventListener("click", () => location.reload());
    const changer = wrap.querySelector("#changer-compte");
    if (changer) changer.addEventListener("click", () => {
      api.setSession(null);
      location.reload();
    });
    app.innerHTML = "";
    app.appendChild(wrap);
  }

  async function renderInterne() {
    if (!state.me) return renderLogin();
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
    metierCourant = api.metierEntreprise ? api.metierEntreprise() : null;
    employesCache = await api.listEmployes();
    if (state.me.role === "patron") {
      if (state.onglet === "modules") return viewModules();
      if (state.onglet === "equipe") return viewEquipe();
      return viewPlanning();
    }
    return viewTournee();
  }

  async function render() {
    try {
      return await renderInterne();
    } catch (error) {
      afficherErreurGlobale(error);
      return null;
    }
  }

  // Ponts pour les modules : re-render et navigation.
  window.Chantier.rerender = render;
  // Qui est connecté, pour tracer l'auteur d'un mouvement de stock.
  window.Chantier.moiId = function () { return state.me ? state.me.id : null; };
  window.Chantier.allerModules = function () {
    state.onglet = "modules";
    state.moduleCle = null;
    render();
  };
  window.Chantier.allerPlanning = function (iso) {
    state.onglet = "planning";
    state.socleVue = null;
    if (iso) { state.date = iso; state.vue = "jour"; }
    render();
  };

  // ---------- Demarrage ----------
  async function boot() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    let erreurDemarrage = null;
    try {
      if (api.init) await api.init(); // cloud : restaure la session + charge le profil
    } catch (e) {
      erreurDemarrage = e;
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
            ? { type: "ok", texte: "Paiement confirmé, votre abonnement est actif. Merci !" }
            : { type: "attente", texte: "Paiement bien reçu. L'activation est en cours de validation, cela peut prendre quelques secondes. Actualisez si l'accès n'est pas encore ouvert." };
        } else if (retour === "annule") {
          pendingAboMsg = { type: "info", texte: "Paiement annulé. Vous pouvez choisir une formule quand vous voulez." };
        }
      }
    } catch (e) {}
    if (erreurDemarrage) {
      afficherErreurGlobale(erreurDemarrage);
      return;
    }
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
