/*
 * backend-supabase.js - Backend CLOUD de Chantier.
 *
 * Expose EXACTEMENT la meme interface que le backend demo (js/api.js),
 * pour que tout le reste de l'appli (app.js) ne fasse aucune difference.
 * Ici les donnees viennent de Supabase (Postgres + RLS) au lieu du
 * localStorage. La conversion des formats se fait ici :
 *   - colonnes DB en snake_case  <->  champs UI en camelCase
 *   - dates serveur (timestamptz) <->  millisecondes attendues par l'UI
 *
 * L'isolation par entreprise est garantie cote serveur par la RLS :
 * une requete ne peut jamais toucher les donnees d'une autre entreprise.
 */
(function () {
  "use strict";

  // --- Configuration du projet (cle PUBLIABLE, protegee par la RLS) ---
  const SUPABASE_URL = "https://sksyieafxqhlrhmcyafo.supabase.co";
  const SUPABASE_KEY = "sb_publishable__baMXDrXoknsGAmgi5_NCQ_ZdrD0gF5";

  let sb = null;          // client supabase
  let me = null;          // profil connecte, format UI {id, nom, role, couleur}
  let entrepriseId = null;
  let entreprise = null;  // {nom, code}
  let employesCache = null;
  let modulesCache = [];  // noms des modules payants actifs pour l'entreprise
  let factCache = null;   // { actif, jusqu } de l'abonnement de base

  function client() {
    if (!sb) {
      sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      // F4/temps reel : Realtime evalue la RLS au role de la connexion WebSocket.
      // Sans le JWT authentifie, ce role est "anon" et ne voit AUCUNE ligne de
      // l'entreprise => tous les INSERT/UPDATE sont filtres (rien n'arrive avant
      // un refresh manuel). On propage donc le token a Realtime des qu'il change
      // (connexion, refresh auto, deconnexion).
      sb.auth.onAuthStateChange((_event, session) => {
        try {
          sb.realtime.setAuth(session ? session.access_token : SUPABASE_KEY);
        } catch (e) {}
      });
    }
    return sb;
  }

  // ---------- Conversions DB <-> UI ----------
  function ms(ts) { return ts ? new Date(ts).getTime() : null; }

  function mapProfil(p) {
    return { id: p.id, nom: p.nom, role: p.role, couleur: p.couleur };
  }
  function mapInter(r) {
    return {
      id: r.id,
      date: r.date,
      dateFin: r.date_fin,
      employeId: r.employe_id,
      statut: r.statut,
      heure: r.heure || "",
      client: r.client || "",
      adresse: r.adresse || "",
      tel: r.tel || "",
      description: r.description || "",
    };
  }
  function mapPointage(p) {
    return { id: p.id, interventionId: p.intervention_id, employeId: p.employe_id, debut: ms(p.debut), fin: ms(p.fin) };
  }
  function mapNote(n) {
    return { id: n.id, ts: ms(n.ts), employeId: n.employe_id, texte: n.texte || "", brut: n.brut || "", parIA: !!n.par_ia };
  }

  function boom(error, message) {
    if (error) throw new Error(message || error.message || "Erreur Supabase");
  }

  // Date ISO (YYYY-MM-DD) du jour, en local.
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // Normalise l'ancien vocabulaire (essai/actif/suspendu/resilie) vers le
  // nouveau, pour que l'app fonctionne avant comme apres la migration 08.
  function normStatut(s) {
    switch (s) {
      case "essai": return "trialing";
      case "actif": return "active";
      case "suspendu": return "past_due";
      case "resilie": return "canceled";
      default: return s || "trialing";
    }
  }

  // Convertit la ligne entreprise_facturation en objet UI enrichi.
  // "ouvert" = l'app est-elle utilisable ? Meme regle que le serveur
  // (app.abonnement_ouvert) : active => oui ; trialing => oui tant que
  // essai_fin est present ET non expire. Tout le reste => ferme.
  // "statutEffectif" derive 'trial_expired' d'un essai dont la date est passee.
  function mapFacturation(fact) {
    const statut = normStatut(fact.statut || (fact.abonnement_actif ? "actif" : "past_due"));
    const essaiFin = fact.essai_fin || null;     // timestamp ISO (ou ancienne date)
    const periodeFin = fact.periode_fin || null; // timestamp ISO
    const maintenant = Date.now();
    const essaiValide = !!essaiFin && new Date(essaiFin).getTime() >= maintenant;
    const periodeValide = !!periodeFin && new Date(periodeFin).getTime() >= maintenant;
    // Meme regle que le serveur (app.abonnement_ouvert), a la seconde :
    //   active ; trialing non expire ; canceled encore dans la periode payee.
    const ouvert = statut === "active" ||
      (statut === "trialing" && essaiValide) ||
      (statut === "canceled" && periodeValide);
    let statutEffectif = statut;
    if (statut === "trialing" && !essaiValide) statutEffectif = "trial_expired";
    return {
      statut: statut,
      statutEffectif: statutEffectif,
      formule: fact.formule || null,
      essaiFin: essaiFin,
      periodeFin: periodeFin,
      maxUtilisateurs: fact.max_utilisateurs || null,
      provider: fact.provider || null,
      aClientStripe: !!fact.provider_customer_id,
      ouvert: ouvert,
      // Compat avec l'ancien affichage.
      actif: ouvert,
      jusqu: periodeFin || essaiFin || fact.abonnement_jusqu || null,
    };
  }

  // ---------- Chargement du profil connecte ----------
  async function chargerProfil() {
    const c = client();
    const { data: sess } = await c.auth.getSession();
    if (!sess || !sess.session) { me = null; entrepriseId = null; entreprise = null; employesCache = null; modulesCache = []; factCache = null; return null; }
    const uid = sess.session.user.id;
    const { data: prof, error } = await c.from("profils").select("*").eq("id", uid).maybeSingle();
    if (error) boom(error);
    if (!prof) { me = null; entrepriseId = null; return null; } // connecte mais sans entreprise
    me = mapProfil(prof);
    entrepriseId = prof.entreprise_id;
    const { data: ent } = await c.from("entreprises").select("nom, code").eq("id", entrepriseId).maybeSingle();
    entreprise = ent || null;
    employesCache = null; // sera recharge
    // Droits : modules payants actifs + statut de l'abonnement de base
    const { data: mods } = await c.from("entreprise_modules").select("module, actif").eq("actif", true);
    modulesCache = (mods || []).map((m) => m.module);
    const { data: fact } = await c.from("entreprise_facturation").select("*").maybeSingle();
    factCache = fact ? mapFacturation(fact) : null;
    return me;
  }

  const SupabaseBackend = {
    // --- Demarrage : restaure la session et charge le profil ---
    async init() {
      client();
      await chargerProfil();
      return true;
    },

    // --- Authentification (utilisee par le vrai ecran de connexion) ---
    estCloud: true,
    async signIn(email, password) {
      const c = client();
      const { error } = await c.auth.signInWithPassword({ email: (email || "").trim(), password });
      boom(error, "Email ou mot de passe incorrect.");
      const prof = await chargerProfil();
      if (!prof) throw new Error("no-profile"); // connecte mais pas encore rattache a une entreprise
      return prof;
    },
    async signUpPatron(email, password, nomEntreprise, nomPatron) {
      const c = client();
      const { error } = await c.auth.signUp({ email: (email || "").trim(), password });
      boom(error, "Inscription impossible (email deja utilise ?).");
      const { error: e2 } = await c.rpc("creer_entreprise", {
        p_nom_entreprise: nomEntreprise, p_nom_patron: nomPatron, p_couleur: "#38bdf8",
      });
      boom(e2);
      return chargerProfil();
    },
    async signUpEmploye(email, password, code, nom) {
      const c = client();
      const { error } = await c.auth.signUp({ email: (email || "").trim(), password });
      boom(error, "Inscription impossible (email deja utilise ?).");
      const { error: e2 } = await c.rpc("rejoindre_entreprise", {
        p_code: code, p_nom: nom, p_couleur: "#34d399",
      });
      boom(e2, "Code entreprise invalide.");
      return chargerProfil();
    },
    // Cas : compte cree mais sans entreprise (rare). Permet de finir l'onboarding.
    async rejoindreAvecCode(code, nom) {
      const { error } = await client().rpc("rejoindre_entreprise", { p_code: code, p_nom: nom, p_couleur: "#34d399" });
      boom(error, "Code entreprise invalide.");
      return chargerProfil();
    },

    infoEntreprise() { return entreprise; }, // {nom, code} pour l'affichage patron

    // --- Droits (modules payants + abonnement de base) ---
    modulesActifs() { return (modulesCache || []).slice(); },
    facturation() { return factCache; },

    // --- Abonnement Stripe (Edge Functions) ---
    // Recharge l'etat de facturation depuis la base (apres retour de paiement).
    async rechargerFacturation() {
      const c = client();
      const { data: fact } = await c.from("entreprise_facturation").select("*").maybeSingle();
      factCache = fact ? mapFacturation(fact) : null;
      return factCache;
    },
    // Apres un retour de paiement (regle 8 : on n'accorde JAMAIS l'acces sur
    // le seul retour de page, on relit la base). Le webhook signe peut avoir un
    // leger decalage : on relit quelques fois jusqu'a voir l'abonnement ouvert.
    async attendreActivation(essais, delaiMs) {
      essais = essais || 6; delaiMs = delaiMs || 1500;
      for (let i = 0; i < essais; i++) {
        const f = await this.rechargerFacturation();
        if (f && f.ouvert) return f;
        if (i < essais - 1) await new Promise((r) => setTimeout(r, delaiMs));
      }
      return factCache;
    },
    // Demande une session Checkout pour la formule choisie. Renvoie l'URL Stripe.
    async creerCheckout(formule) {
      const { data, error } = await client().functions.invoke("creer-checkout", { body: { formule: formule } });
      if (error) throw new Error(error.message || "Impossible de creer le paiement");
      if (!data || !data.url) throw new Error((data && data.error) || "Reponse de paiement invalide");
      return data.url;
    },
    // Ouvre le portail Stripe (gerer / annuler l'abonnement). Renvoie l'URL.
    async ouvrirPortail() {
      const { data, error } = await client().functions.invoke("portail-client", { body: {} });
      if (error) throw new Error(error.message || "Portail indisponible");
      if (!data || !data.url) throw new Error((data && data.error) || "Reponse du portail invalide");
      return data.url;
    },

    // --- Session ---
    getSession() { return me; },              // synchrone, lit le cache charge par init()
    setSession(v) {
      if (!v) {
        const c = client();
        c.auth.signOut().catch(() => {});
        me = null; entrepriseId = null; entreprise = null; employesCache = null; modulesCache = []; factCache = null;
      }
    },

    async listEmployes() {
      if (employesCache) return employesCache.slice();
      const { data, error } = await client().from("profils").select("*").order("role", { ascending: true });
      boom(error);
      employesCache = (data || []).map(mapProfil);
      return employesCache.slice();
    },

    // --- Interventions / chantiers ---
    async listInterventions(filtre) {
      filtre = filtre || {};
      let q = client().from("interventions").select("*");
      if (filtre.date) q = q.lte("date", filtre.date).gte("date_fin", filtre.date);
      if (filtre.from && filtre.to) q = q.lte("date", filtre.to).gte("date_fin", filtre.from);
      if (filtre.employeId) q = q.eq("employe_id", filtre.employeId);
      const { data, error } = await q;
      boom(error);
      const out = (data || []).map(mapInter);
      // Meme tri que la demo : par heure puis date.
      out.sort((a, b) => (a.heure || "99").localeCompare(b.heure || "99") || a.date.localeCompare(b.date));
      // Rattache le compteur de notes (pastille "Suivi") comme en demo.
      const ids = out.map((i) => i.id);
      if (ids.length) {
        const { data: notes } = await client().from("journal").select("id, intervention_id").in("intervention_id", ids);
        const parInter = {};
        (notes || []).forEach((n) => { (parInter[n.intervention_id] = parInter[n.intervention_id] || []).push(n); });
        out.forEach((i) => { i.journal = parInter[i.id] || []; });
      }
      return out;
    },
    async getIntervention(id) {
      const { data, error } = await client().from("interventions").select("*").eq("id", id).maybeSingle();
      boom(error);
      return data ? mapInter(data) : null;
    },
    async createIntervention(data) {
      const dateDebut = data.date || window.Chantier.util.todayISO();
      const row = {
        entreprise_id: entrepriseId,
        date: dateDebut,
        date_fin: data.dateFin && data.dateFin >= dateDebut ? data.dateFin : dateDebut,
        heure: data.heure || "",
        employe_id: data.employeId || null,
        statut: "a_faire",
        client: data.client || "",
        adresse: data.adresse || "",
        tel: data.tel || "",
        description: data.description || "",
      };
      const { data: ins, error } = await client().from("interventions").insert(row).select().single();
      boom(error);
      return mapInter(ins);
    },
    async updateIntervention(id, patch) {
      // On relit la ligne pour reproduire exactement la logique de la demo
      // (notamment le garde-fou date_fin >= date).
      const cur = await this.getIntervention(id);
      if (!cur) throw new Error("Intervention introuvable");
      const merged = Object.assign({}, cur, patch);
      if (!merged.dateFin || merged.dateFin < merged.date) merged.dateFin = merged.date;
      const row = {
        date: merged.date,
        date_fin: merged.dateFin,
        heure: merged.heure || "",
        employe_id: merged.employeId || null,
        client: merged.client || "",
        adresse: merged.adresse || "",
        tel: merged.tel || "",
        description: merged.description || "",
      };
      const { data, error } = await client().from("interventions").update(row).eq("id", id).select().single();
      boom(error);
      return mapInter(data);
    },
    async setStatut(id, statut) {
      const { data, error } = await client().from("interventions").update({ statut }).eq("id", id).select().single();
      boom(error);
      return mapInter(data);
    },
    async deleteIntervention(id) {
      const { error } = await client().from("interventions").delete().eq("id", id);
      boom(error);
      return true;
    },

    // --- Journal de suivi ---
    async listJournal(interventionId) {
      const { data, error } = await client().from("journal").select("*").eq("intervention_id", interventionId).order("ts", { ascending: false });
      boom(error);
      return (data || []).map(mapNote);
    },
    async ajouterNote(interventionId, note) {
      const row = {
        entreprise_id: entrepriseId,
        intervention_id: interventionId,
        employe_id: note.employeId || (me && me.id) || null,
        texte: (note.texte || "").trim(),
        brut: (note.brut || "").trim(),
        par_ia: !!note.parIA,
      };
      const { data, error } = await client().from("journal").insert(row).select().single();
      boom(error);
      return mapNote(data);
    },
    async supprimerNote(interventionId, noteId) {
      const { error } = await client().from("journal").delete().eq("id", noteId);
      boom(error);
      return true;
    },

    // --- Pointage (heures) ---
    async pointageEnCours(employeId) {
      const { data, error } = await client().from("pointages").select("*").eq("employe_id", employeId).is("fin", null).limit(1);
      boom(error);
      return data && data[0] ? mapPointage(data[0]) : null;
    },
    async demarrerPointage(interventionId, employeId) {
      const c = client();
      const now = new Date().toISOString();
      // Cloture un eventuel pointage encore ouvert pour ce gars
      await c.from("pointages").update({ fin: now }).eq("employe_id", employeId).is("fin", null);
      const { data, error } = await c.from("pointages")
        .insert({ entreprise_id: entrepriseId, intervention_id: interventionId, employe_id: employeId, debut: now })
        .select().single();
      boom(error);
      await c.from("interventions").update({ statut: "en_cours" }).eq("id", interventionId);
      return mapPointage(data);
    },
    async terminerPointage(pointageId) {
      const c = client();
      const now = new Date().toISOString();
      const { data: p, error } = await c.from("pointages").update({ fin: now }).eq("id", pointageId).select().single();
      boom(error, "Pointage introuvable");
      const it = await this.getIntervention(p.intervention_id);
      if (it) {
        const long = (it.dateFin || it.date) > it.date;
        await c.from("interventions").update({ statut: long ? "en_cours" : "termine" }).eq("id", it.id);
      }
      return mapPointage(p);
    },
    async listPointages(filtre) {
      filtre = filtre || {};
      let q = client().from("pointages").select("*");
      if (filtre.employeId) q = q.eq("employe_id", filtre.employeId);
      if (filtre.interventionId) q = q.eq("intervention_id", filtre.interventionId);
      const { data, error } = await q;
      boom(error);
      return (data || []).map(mapPointage);
    },

    // Pas de reset en cloud (garde-fou : on ne vide pas une vraie base).
    async resetDemo() { return true; },

    // --- Temps reel : previent quand une donnee de l'entreprise change ---
    // On n'ecoute QUE les INSERT et UPDATE : la RLS les filtre par entreprise
    // (on ne recoit que les evenements de SON entreprise). Les DELETE ne sont
    // volontairement PAS ecoutes : la RLS n'est pas appliquee aux evenements
    // DELETE de postgres_changes (ils seraient diffuses a toutes les
    // entreprises). Une suppression est donc simplement reflechie au prochain
    // rafraichissement (F4, option A). Voir scratch/audit_clicchantier_f4_realtime.md.
    subscribeChanges(cb) {
      const c = client();
      let ch = null;
      // On garantit que Realtime a bien le JWT authentifie AVANT de s'abonner,
      // sinon la RLS filtre tous les evenements (voir client()).
      (async () => {
        try {
          const { data } = await c.auth.getSession();
          const token = data && data.session && data.session.access_token;
          if (token) c.realtime.setAuth(token);
        } catch (e) {}
        ch = c.channel("chantier-sync-" + (entrepriseId || "x"))
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "interventions" }, cb)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "interventions" }, cb)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "pointages" }, cb)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pointages" }, cb)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "journal" }, cb)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "journal" }, cb)
          .subscribe();
      })();
      return { unsubscribe() { try { if (ch) c.removeChannel(ch); } catch (e) {} } };
    },
  };

  window.Chantier = window.Chantier || {};
  window.Chantier.backends = window.Chantier.backends || {};
  window.Chantier.backends.supabase = SupabaseBackend;
})();
