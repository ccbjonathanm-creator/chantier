/*
 * api.js - Couche d'acces aux donnees.
 *
 * Toute l'appli parle a "Chantier.api" et ne sait pas si les donnees
 * viennent d'un mode demo local (localStorage) ou du vrai cloud (Supabase).
 * On construit et on teste tout sur le mode DEMO, puis on branchera Supabase
 * sans toucher au reste de l'appli.
 */
(function () {
  "use strict";

  const STORE_KEY = "chantier_demo_v3";
  const SESSION_KEY = "chantier_session_v1";

  function uid() {
    return "id_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function addDays(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d + n);
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  }

  // --- Jeu de donnees de demonstration (une entreprise, un patron, 2 gars) ---
  function seed() {
    const patronId = "u_patron";
    const e1 = "u_karim";
    const e2 = "u_lucas";
    const j = todayISO();
    return {
      entreprise: { nom: "Plomberie Martin" },
      employes: [
        { id: patronId, nom: "Vous (patron)", role: "patron", couleur: "#38bdf8" },
        { id: e1, nom: "Karim B.", role: "employe", couleur: "#f59e0b" },
        { id: e2, nom: "Lucas D.", role: "employe", couleur: "#34d399" },
      ],
      interventions: [
        {
          id: uid(), date: j, dateFin: addDays(j, 4), employeId: e1, statut: "a_faire", heure: "08:00",
          client: "M. et Mme Roux", adresse: "24 rue de la Republique, Le Creusot", tel: "0611223344",
          description: "Renovation salle de bain complete : depose ancienne, plomberie, pose douche a l'italienne, meuble et robinetterie.",
        },
        {
          id: uid(), date: j, dateFin: j, employeId: e1, statut: "a_faire", heure: "16:00",
          client: "M. Petit", adresse: "5 av. de la Gare, Montceau", tel: "0655667788",
          description: "Chasse d'eau qui coule en continu. Remplacer le mecanisme.",
        },
        {
          id: uid(), date: j, dateFin: j, employeId: e2, statut: "a_faire", heure: "09:00",
          client: "Boulangerie du Centre", adresse: "3 pl. du Marche, Le Creusot", tel: "0385551122",
          description: "Chauffe-eau en panne, pas d'eau chaude. Diagnostic.",
        },
        // Quelques chantiers repartis sur le mois et l'annee (pour les vues Mois / Annee)
        {
          id: uid(), date: addDays(j, 2), dateFin: addDays(j, 2), employeId: e2, statut: "a_faire", heure: "08:30",
          client: "M. Girard", adresse: "8 rue Neuve, Torcy", tel: "0611002200",
          description: "Remplacement d'un ballon d'eau chaude 200L.",
        },
        {
          id: uid(), date: addDays(j, 6), dateFin: addDays(j, 9), employeId: e2, statut: "a_faire", heure: "08:00",
          client: "Copropriete Les Tilleuls", adresse: "15 bd Henri Paul Schneider, Le Creusot", tel: "0385009911",
          description: "Refection colonne d'eau, remplacement de vannes sur 4 etages.",
        },
        {
          id: uid(), date: addDays(j, 8), dateFin: addDays(j, 8), employeId: e1, statut: "a_faire", heure: "14:00",
          client: "Mme Leroy", adresse: "2 impasse des Roses, Montchanin", tel: "0622113344",
          description: "Installation d'un lave-vaisselle et raccordement.",
        },
        {
          id: uid(), date: addDays(j, 14), dateFin: addDays(j, 14), employeId: e1, statut: "a_faire", heure: "09:30",
          client: "Garage Central", adresse: "40 route de Chalon, Le Creusot", tel: "0385447788",
          description: "Fuite reseau air comprime, controle raccords.",
        },
        {
          id: uid(), date: addDays(j, 21), dateFin: addDays(j, 25), employeId: e1, statut: "a_faire", heure: "08:00",
          client: "Restaurant Le Gourmet", adresse: "12 rue Marechal Foch, Autun", tel: "0385551199",
          description: "Renovation complete de la cuisine : plomberie, evacuations, adoucisseur.",
        },
        {
          id: uid(), date: addDays(j, 40), dateFin: addDays(j, 40), employeId: e2, statut: "a_faire", heure: "10:00",
          client: "M. Fontaine", adresse: "6 chemin du Bois, Le Breuil", tel: "0699887766",
          description: "Entretien annuel chaudiere gaz.",
        },
      ],
      pointages: [], // { id, interventionId, employeId, debut, fin }
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    const fresh = seed();
    save(fresh);
    return fresh;
  }

  function save(db) {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  }

  // Simule un petit delai reseau pour que l'appli soit ecrite comme si c'etait
  // du vrai cloud (async partout), et qu'on n'ait rien a changer plus tard.
  function delay(v) {
    return new Promise((res) => setTimeout(() => res(v), 60));
  }

  const DemoBackend = {
    // Demarrage : rien de special en demo (les donnees sont locales).
    async init() { return true; },
    estCloud: false,

    // --- Session (qui suis-je) ---
    async listEmployes() {
      const db = load();
      return delay(db.employes.slice());
    },
    getSession() {
      try {
        const id = localStorage.getItem(SESSION_KEY);
        if (!id) return null;
        const db = load();
        return db.employes.find((e) => e.id === id) || null;
      } catch (e) {
        return null;
      }
    },
    setSession(employeId) {
      if (employeId) localStorage.setItem(SESSION_KEY, employeId);
      else localStorage.removeItem(SESSION_KEY);
    },

    // --- Interventions / chantiers ---
    async listInterventions(filtre) {
      const db = load();
      let out = db.interventions.slice();
      // Un chantier apparait chaque jour de sa periode (date -> dateFin).
      if (filtre && filtre.date) {
        out = out.filter((i) => {
          const fin = i.dateFin || i.date;
          return i.date <= filtre.date && filtre.date <= fin;
        });
      }
      // Plage (mois, annee) : garde les chantiers qui chevauchent [from, to].
      if (filtre && filtre.from && filtre.to) {
        out = out.filter((i) => {
          const fin = i.dateFin || i.date;
          return i.date <= filtre.to && fin >= filtre.from;
        });
      }
      if (filtre && filtre.employeId) out = out.filter((i) => i.employeId === filtre.employeId);
      out.sort((a, b) => (a.heure || "99").localeCompare(b.heure || "99") || a.date.localeCompare(b.date));
      return delay(out);
    },
    async getIntervention(id) {
      const db = load();
      return delay(db.interventions.find((i) => i.id === id) || null);
    },
    async createIntervention(data) {
      const db = load();
      const dateDebut = data.date || todayISO();
      const inter = {
        id: uid(),
        date: dateDebut,
        dateFin: data.dateFin && data.dateFin >= dateDebut ? data.dateFin : dateDebut,
        heure: data.heure || "",
        employeId: data.employeId || null,
        statut: "a_faire",
        client: data.client || "",
        adresse: data.adresse || "",
        tel: data.tel || "",
        description: data.description || "",
      };
      db.interventions.push(inter);
      save(db);
      return delay(inter);
    },
    async updateIntervention(id, patch) {
      const db = load();
      const it = db.interventions.find((i) => i.id === id);
      if (!it) throw new Error("Intervention introuvable");
      Object.assign(it, patch);
      if (!it.dateFin || it.dateFin < it.date) it.dateFin = it.date;
      save(db);
      return delay(it);
    },
    // Marquer un chantier termine / le rouvrir (utile pour les chantiers longs).
    async setStatut(id, statut) {
      const db = load();
      const it = db.interventions.find((i) => i.id === id);
      if (!it) throw new Error("Intervention introuvable");
      it.statut = statut;
      save(db);
      return delay(it);
    },

    // --- Journal de suivi du chantier (notes vocales + comptes-rendus IA) ---
    async listJournal(interventionId) {
      const db = load();
      const it = db.interventions.find((i) => i.id === interventionId);
      const j = (it && it.journal) ? it.journal.slice() : [];
      j.sort((a, b) => b.ts - a.ts); // plus recent d'abord
      return delay(j);
    },
    async ajouterNote(interventionId, note) {
      const db = load();
      const it = db.interventions.find((i) => i.id === interventionId);
      if (!it) throw new Error("Intervention introuvable");
      if (!it.journal) it.journal = [];
      const entree = {
        id: uid(),
        ts: Date.now(),
        employeId: note.employeId || null,
        texte: (note.texte || "").trim(),
        brut: (note.brut || "").trim(),
        parIA: !!note.parIA,
      };
      it.journal.push(entree);
      save(db);
      return delay(entree);
    },
    async supprimerNote(interventionId, noteId) {
      const db = load();
      const it = db.interventions.find((i) => i.id === interventionId);
      if (it && it.journal) it.journal = it.journal.filter((n) => n.id !== noteId);
      save(db);
      return delay(true);
    },
    async deleteIntervention(id) {
      const db = load();
      db.interventions = db.interventions.filter((i) => i.id !== id);
      db.pointages = db.pointages.filter((p) => p.interventionId !== id);
      save(db);
      return delay(true);
    },

    // --- Pointage (heures) ---
    async pointageEnCours(employeId) {
      const db = load();
      return delay(db.pointages.find((p) => p.employeId === employeId && !p.fin) || null);
    },
    async demarrerPointage(interventionId, employeId) {
      const db = load();
      // Cloture un eventuel pointage encore ouvert pour ce gars
      db.pointages.forEach((p) => {
        if (p.employeId === employeId && !p.fin) p.fin = Date.now();
      });
      const p = { id: uid(), interventionId, employeId, debut: Date.now(), fin: null };
      db.pointages.push(p);
      const it = db.interventions.find((i) => i.id === interventionId);
      if (it) it.statut = "en_cours";
      save(db);
      return delay(p);
    },
    async terminerPointage(pointageId) {
      const db = load();
      const p = db.pointages.find((x) => x.id === pointageId);
      if (!p) throw new Error("Pointage introuvable");
      p.fin = Date.now();
      const it = db.interventions.find((i) => i.id === p.interventionId);
      if (it) {
        const long = (it.dateFin || it.date) > it.date;
        // Chantier d'un jour : "Arreter" = termine. Chantier long : on reste
        // "en cours", le chantier n'est fini que via le bouton dedie.
        it.statut = long ? "en_cours" : "termine";
      }
      save(db);
      return delay(p);
    },
    async listPointages(filtre) {
      const db = load();
      let out = db.pointages.slice();
      if (filtre && filtre.employeId) out = out.filter((p) => p.employeId === filtre.employeId);
      if (filtre && filtre.interventionId) out = out.filter((p) => p.interventionId === filtre.interventionId);
      return delay(out);
    },

    // Utilitaire demo : remise a zero
    async resetDemo() {
      const fresh = seed();
      save(fresh);
      return delay(true);
    },

    // Pas de temps reel en mode demo (tout est local sur l'appareil).
    subscribeChanges() { return { unsubscribe() {} }; },

    // Droits en mode demo : modules lus depuis un reglage local (pour tester),
    // abonnement de base toujours actif.
    modulesActifs() {
      try { return JSON.parse(localStorage.getItem("chantier_demo_modules") || "[]"); } catch (e) { return []; }
    },
    facturation() { return { actif: true, jusqu: null }; },
  };

  window.Chantier = window.Chantier || {};
  window.Chantier.backends = window.Chantier.backends || {};
  window.Chantier.backends.demo = DemoBackend;
  // Par defaut on reste en demo ; app.js choisira le backend au demarrage.
  if (!window.Chantier.api) window.Chantier.api = DemoBackend;
  window.Chantier.util = { uid, todayISO };
})();
