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
      clientId: r.client_id || null,
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
  function mapClient(c) {
    return {
      id: c.id, kind: c.kind, displayName: c.display_name, legalName: c.legal_name || "",
      siren: c.siren || "", vatNumber: c.vat_number || "",
      billingAddressLine1: c.billing_address_line1 || "", billingAddressLine2: c.billing_address_line2 || "",
      billingPostalCode: c.billing_postal_code || "", billingCity: c.billing_city || "",
      billingCountryCode: c.billing_country_code || "FR",
    };
  }
  function clientRow(c) {
    return {
      kind: c.kind, display_name: c.displayName, legal_name: c.legalName || null,
      siren: c.siren || null, vat_number: c.vatNumber || null,
      billing_address_line1: c.billingAddressLine1 || null,
      billing_address_line2: c.billingAddressLine2 || null,
      billing_postal_code: c.billingPostalCode || null, billing_city: c.billingCity || null,
      billing_country_code: c.billingCountryCode || "FR",
    };
  }
  function mapCatalogItem(i) {
    return {
      id: i.id, categoryId: i.category_id || null, kind: i.kind, reference: i.reference || "",
      label: i.label, description: i.description || "", unit: i.unit,
      unitPriceExclTax: Number(i.unit_price_excl_tax), vatRate: Number(i.vat_rate),
      purchasePriceExclTax: i.purchase_price_excl_tax == null ? null : Number(i.purchase_price_excl_tax),
    };
  }

  // Les totaux du devis se recalculent TOUJOURS depuis ses lignes, jamais
  // depuis une saisie. Meme regle que le mode demonstration.
  async function recalculerTotauxDevis(devisId) {
    const { data, error } = await client().from("devis_lignes")
      .select("quantite, prix_unitaire_ht, taux_tva").eq("devis_id", devisId);
    boom(error);
    let ht = 0;
    let tva = 0;
    (data || []).forEach((l) => {
      const ligneHT = arrondir(Number(l.quantite) * Number(l.prix_unitaire_ht));
      ht += ligneHT;
      tva += arrondir(ligneHT * (Number(l.taux_tva) / 100));
    });
    const { error: e2 } = await client().from("devis").update({
      total_ht: arrondir(ht), total_tva: arrondir(tva), total_ttc: arrondir(ht + tva),
    }).eq("id", devisId);
    boom(e2);
  }

  // Les totaux de la facture se recalculent depuis ses lignes, comme le devis.
  async function recalculerTotauxFacture(factureId) {
    const { data, error } = await client().from("facture_lignes")
      .select("quantite, prix_unitaire_ht, taux_tva").eq("facture_id", factureId);
    boom(error);
    let ht = 0;
    let tva = 0;
    (data || []).forEach((l) => {
      const ligneHT = arrondir(Number(l.quantite) * Number(l.prix_unitaire_ht));
      ht += ligneHT;
      tva += arrondir(ligneHT * (Number(l.taux_tva) / 100));
    });
    const { error: e2 } = await client().from("factures").update({
      total_ht: arrondir(ht), total_tva: arrondir(tva), total_ttc: arrondir(ht + tva),
    }).eq("id", factureId);
    boom(e2);
  }

  function mapParametresRelance(p) {
    return {
      delaiDevis1: Number(p.delai_devis_1), delaiDevis2: Number(p.delai_devis_2),
      delaiFacture1: Number(p.delai_facture_1), delaiFacture2: Number(p.delai_facture_2),
      ton: p.ton,
    };
  }

  function mapRelance(r) {
    return {
      id: r.id, cibleType: r.cible_type,
      devisId: r.devis_id || null, factureId: r.facture_id || null,
      niveau: Number(r.niveau), statut: r.statut, message: r.message,
      prepareLe: r.prepare_le, envoyeeLe: r.envoyee_le || null,
      envoyeePar: r.envoyee_par || null, annuleeLe: r.annulee_le || null,
    };
  }

  function mapParametres(p) {
    return {
      vendeurSnapshot: p.vendeur_snapshot || {},
      conditionsPaiement: p.conditions_paiement,
      penalitesRetard: p.penalites_retard,
      indemniteRecouvrement: Number(p.indemnite_recouvrement),
      mentionTva: p.mention_tva || "",
    };
  }

  function mapFacture(f) {
    return {
      id: f.id, clientId: f.client_id, devisId: f.devis_id || null,
      genre: f.genre, numero: f.numero || null, statut: f.statut,
      dateEmission: f.date_emission || null, dateEcheance: f.date_echeance || null,
      clientSnapshot: f.client_snapshot || {}, vendeurSnapshot: f.vendeur_snapshot || {},
      contenuSnapshot: f.contenu_snapshot || null,
      conditionsPaiement: f.conditions_paiement || "", penalitesRetard: f.penalites_retard || "",
      indemniteRecouvrement: f.indemnite_recouvrement == null ? null : Number(f.indemnite_recouvrement),
      mentionTva: f.mention_tva || "",
      totalHT: Number(f.total_ht), totalTVA: Number(f.total_tva), totalTTC: Number(f.total_ttc),
      valideLe: f.valide_le || null, validePar: f.valide_par || null,
      emiseLe: f.emise_le || null, annuleeLe: f.annulee_le || null,
      createdAt: f.created_at,
    };
  }

  function mapFactureLigne(l) {
    return {
      id: l.id, factureId: l.facture_id, catalogItemId: l.catalog_item_id || null,
      position: Number(l.position), libelleSnapshot: l.libelle_snapshot,
      descriptionSnapshot: l.description_snapshot || "", uniteSnapshot: l.unite_snapshot,
      quantite: Number(l.quantite), prixUnitaireHT: Number(l.prix_unitaire_ht),
      tauxTVA: Number(l.taux_tva),
    };
  }

  function mapPaiement(p) {
    return {
      id: p.id, factureId: p.facture_id, montant: Number(p.montant),
      payeLe: p.paye_le, moyen: p.moyen, note: p.note || "",
    };
  }

  function mapDevis(d) {
    return {
      id: d.id, clientId: d.client_id, titre: d.titre, statut: d.statut,
      clientSnapshot: d.client_snapshot || {},
      totalHT: Number(d.total_ht), totalTVA: Number(d.total_tva), totalTTC: Number(d.total_ttc),
      valideLe: d.valide_le || null, validePar: d.valide_par || null,
      envoyeLe: d.envoye_le || null, reponduLe: d.repondu_le || null,
      createdAt: d.created_at,
    };
  }

  function mapDevisLigne(l) {
    return {
      id: l.id, devisId: l.devis_id, catalogItemId: l.catalog_item_id || null,
      position: Number(l.position),
      libelleSnapshot: l.libelle_snapshot, descriptionSnapshot: l.description_snapshot || "",
      uniteSnapshot: l.unite_snapshot,
      quantite: Number(l.quantite), prixUnitaireHT: Number(l.prix_unitaire_ht),
      tauxTVA: Number(l.taux_tva),
    };
  }

  function boom(error, message) {
    if (error) throw new Error(message || error.message || "Erreur Supabase");
  }

  function arrondir(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
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
    const { data: ent, error: entrepriseError } = await c.from("entreprises")
      .select("nom, code, metier").eq("id", entrepriseId).maybeSingle();
    boom(entrepriseError,
      "Impossible de charger votre entreprise. La base en ligne doit être mise à jour avant de pouvoir utiliser ClicChantier.");
    if (!ent) throw new Error("Votre entreprise est introuvable. Contactez l'assistance avant de créer de nouvelles données.");
    entreprise = ent || null;
    employesCache = null; // sera recharge
    // L'abonnement est la source de verite. La table formule_modules
    // contient la correspondance configurable, sans achat individuel.
    const { data: fact, error: facturationError } = await c
      .from("entreprise_facturation").select("*").maybeSingle();
    boom(facturationError, "Impossible de charger votre abonnement. Réessayez dans quelques instants.");
    factCache = fact ? mapFacturation(fact) : null;
    modulesCache = [];
    if (fact && fact.formule) {
      const { data: mods, error: modulesError } = await c
        .from("formule_modules")
        .select("module")
        .eq("formule", fact.formule)
        .eq("actif", true);
      boom(modulesError,
        "Impossible de charger les modules inclus dans votre formule. La base en ligne doit être mise à jour.");
      modulesCache = (mods || []).map((m) => m.module);
      if (!modulesCache.length) console.info("Aucun module associé à la formule " + fact.formule
        + ", voir 11b_seed_formules_EXEMPLE.sql.");
    }
    return me;
  }

  // ---------- Inscription en deux temps (confirmation d'e-mail) ----------
  // Quand "Confirm email" est actif cote Supabase, signUp N'OUVRE PAS de session :
  // l'utilisateur doit d'abord cliquer le lien recu. Or creer_entreprise et
  // rejoindre_entreprise exigent une session (EXECUTE est retire a anon), donc
  // les appeler dans la foulee echoue avec "permission denied for function".
  // On memorise donc ce qui a ete saisi, et on finalise au retour de l'utilisateur.
  const CLE_INSCRIPTION = "chantier_inscription_en_attente";

  function memoriserInscription(donnees) {
    try { localStorage.setItem(CLE_INSCRIPTION, JSON.stringify(donnees)); } catch (_) {}
  }
  function lireInscription() {
    try { return JSON.parse(localStorage.getItem(CLE_INSCRIPTION) || "null"); } catch (_) { return null; }
  }
  function oublierInscription() {
    try { localStorage.removeItem(CLE_INSCRIPTION); } catch (_) {}
  }

  // Supabase ne dit pas franchement "cet email existe deja" (ce serait un moyen
  // de deviner qui est inscrit) : il renvoie un utilisateur sans aucune identite.
  function emailDejaPris(data) {
    return !!(data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0);
  }

  // Adresse de retour du lien de confirmation.
  // ATTENTION : sans ce reglage, supabase-js envoie window.location.ORIGIN, qui
  // perd le chemin. Sur GitHub Pages l'appli vit sous /chantier/, donc le client
  // atterrissait sur la racine du domaine (404) et la reprise ne se declenchait
  // jamais. Ce parametre prime sur le "Site URL" du tableau de bord Supabase :
  // le corriger la-bas ne suffit pas, il faut le passer ici.
  function urlRetour() {
    try {
      return location.origin + location.pathname.replace(/[^/]*$/, "");
    } catch (_) {
      return undefined; // repli : Supabase utilisera son Site URL
    }
  }

  // Appelee au demarrage : si une session est ouverte mais qu'aucun profil n'existe
  // encore, c'est que l'utilisateur revient de son e-mail de confirmation.
  async function finaliserInscriptionEnAttente() {
    const att = lireInscription();
    if (!att) return null;
    const c = client();
    const { data: sess } = await c.auth.getSession();
    if (!sess || !sess.session) return null; // pas encore confirme : on garde en attente

    if (att.type === "patron") {
      const { error } = await c.rpc("creer_entreprise", {
        p_nom_entreprise: att.nomEntreprise, p_nom_patron: att.nom, p_couleur: "#38bdf8",
      });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await c.rpc("rejoindre_entreprise", {
        p_code: att.code, p_nom: att.nom, p_couleur: "#34d399",
      });
      if (error) throw new Error(error.message);
    }
    oublierInscription();
    return chargerProfil();
  }

  const SupabaseBackend = {
    // --- Demarrage : restaure la session et charge le profil ---
    async init() {
      client();
      await chargerProfil();
      // Session ouverte mais pas de profil = retour du lien de confirmation.
      if (!me) {
        try { await finaliserInscriptionEnAttente(); }
        catch (e) { console.warn("finalisation inscription:", e); }
      }
      return true;
    },
    // Expose l'etat d'attente pour que l'ecran de connexion sache quoi afficher.
    inscriptionEnAttente() { return lireInscription(); },
    annulerInscriptionEnAttente() { oublierInscription(); },

    // --- Authentification (utilisee par le vrai ecran de connexion) ---
    estCloud: true,
    async signIn(email, password) {
      const c = client();
      const { error } = await c.auth.signInWithPassword({ email: (email || "").trim(), password });
      boom(error, "Email ou mot de passe incorrect.");
      let prof = await chargerProfil();
      // Cas d'une inscription confirmee puis reprise a la main : l'utilisateur
      // se connecte lui-meme au lieu de revenir avec une session ouverte, donc
      // init() est deja passe. On finalise ici aussi, sinon il resterait bloque
      // sur "ce compte n'est rattache a aucune entreprise".
      if (!prof) {
        try { prof = await finaliserInscriptionEnAttente(); }
        catch (e) { console.warn("finalisation inscription:", e); }
      }
      if (!prof) throw new Error("no-profile"); // connecte mais pas encore rattache a une entreprise
      return prof;
    },
    async signUpPatron(email, password, nomEntreprise, nomPatron) {
      const c = client();
      const { data, error } = await c.auth.signUp({
        email: (email || "").trim(), password,
        options: { emailRedirectTo: urlRetour() },
      });
      boom(error, "Inscription impossible.");
      if (emailDejaPris(data)) throw new Error("email-deja-utilise");
      // Pas de session = confirmation d'e-mail exigee : on differe la creation.
      if (!data || !data.session) {
        memoriserInscription({ type: "patron", nomEntreprise: nomEntreprise, nom: nomPatron });
        throw new Error("email-a-confirmer");
      }
      const { error: e2 } = await c.rpc("creer_entreprise", {
        p_nom_entreprise: nomEntreprise, p_nom_patron: nomPatron, p_couleur: "#38bdf8",
      });
      boom(e2);
      oublierInscription();
      return chargerProfil();
    },
    async signUpEmploye(email, password, code, nom) {
      const c = client();
      const { data, error } = await c.auth.signUp({
        email: (email || "").trim(), password,
        options: { emailRedirectTo: urlRetour() },
      });
      boom(error, "Inscription impossible.");
      if (emailDejaPris(data)) throw new Error("email-deja-utilise");
      if (!data || !data.session) {
        memoriserInscription({ type: "employe", code: code, nom: nom });
        throw new Error("email-a-confirmer");
      }
      const { error: e2 } = await c.rpc("rejoindre_entreprise", {
        p_code: code, p_nom: nom, p_couleur: "#34d399",
      });
      boom(e2, "Code entreprise invalide.");
      oublierInscription();
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
    // Metier de l'entreprise : sert a n'afficher que le pack utile.
    metierEntreprise() { return (entreprise && entreprise.metier) || null; },
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

    // --- Clients ---
    async listClients() {
      const { data, error } = await client().from("clients").select("*").is("archived_at", null).order("display_name");
      boom(error);
      return (data || []).map(mapClient);
    },
    async getClient(id) {
      const { data, error } = await client().from("clients").select("*").eq("id", id).is("archived_at", null).maybeSingle();
      boom(error);
      return data ? mapClient(data) : null;
    },
    async createClient(data) {
      const row = Object.assign({ entreprise_id: entrepriseId }, clientRow(data));
      const { data: created, error } = await client().from("clients").insert(row).select().single();
      boom(error);
      return mapClient(created);
    },
    async updateClient(id, data) {
      const { data: updated, error } = await client().from("clients").update(clientRow(data)).eq("id", id).select().single();
      boom(error);
      return mapClient(updated);
    },

    // --- Catalogue de prestations et matériaux ---
    async listCatalogCategories() {
      const { data, error } = await client().from("catalog_categories")
        .select("id,label").is("archived_at", null).order("label");
      boom(error);
      return data || [];
    },
    async createCatalogCategory(data) {
      const { data: created, error } = await client().from("catalog_categories")
        .insert({ entreprise_id: entrepriseId, label: (data.label || "").trim() }).select("id,label").single();
      boom(error);
      return created;
    },
    async listCatalogItems() {
      const { data, error } = await client().from("catalog_items").select("*").is("archived_at", null).order("label");
      boom(error);
      return (data || []).map(mapCatalogItem);
    },
    async getCatalogItem(id) {
      const { data, error } = await client().from("catalog_items").select("*").eq("id", id).is("archived_at", null).maybeSingle();
      boom(error);
      return data ? mapCatalogItem(data) : null;
    },
    async createCatalogItem(data) {
      const row = {
        entreprise_id: entrepriseId, category_id: data.categoryId || null, kind: data.kind,
        reference: data.reference || null, label: data.label, description: data.description || null,
        unit: data.unit, unit_price_excl_tax: data.unitPriceExclTax, vat_rate: data.vatRate,
        purchase_price_excl_tax: data.purchasePriceExclTax,
      };
      const { data: created, error } = await client().from("catalog_items").insert(row).select().single();
      boom(error);
      return mapCatalogItem(created);
    },
    async updateCatalogItem(id, data) {
      const row = {
        category_id: data.categoryId || null, kind: data.kind, reference: data.reference || null,
        label: data.label, description: data.description || null, unit: data.unit,
        unit_price_excl_tax: data.unitPriceExclTax, vat_rate: data.vatRate,
        purchase_price_excl_tax: data.purchasePriceExclTax,
      };
      const { data: updated, error } = await client().from("catalog_items").update(row).eq("id", id).select().single();
      boom(error);
      return mapCatalogItem(updated);
    },
    async linkInterventionClient(interventionId, clientId) {
      const { data, error } = await client().from("interventions")
        .update({ client_id: clientId }).eq("id", interventionId).select().single();
      boom(error);
      return mapInter(data);
    },

    // --- Devis (PALIER 1) ---
    // Les verrous qui comptent (transitions, envoi sans validation, lignes
    // figées hors brouillon) sont posés par des triggers PostgreSQL dans
    // supabase/13_palier_1_devis.sql. Le client ne fait que les respecter :
    // il ne les remplace pas.
    async listDevis() {
      const { data, error } = await client().from("devis").select("*")
        .is("archive_le", null).order("created_at", { ascending: false });
      boom(error);
      return (data || []).map(mapDevis);
    },
    async getDevis(id) {
      const { data, error } = await client().from("devis").select("*").eq("id", id).maybeSingle();
      boom(error);
      if (!data) return null;
      const { data: lignes, error: e2 } = await client().from("devis_lignes")
        .select("*").eq("devis_id", id).order("position");
      boom(e2);
      return Object.assign(mapDevis(data), { lignes: (lignes || []).map(mapDevisLigne) });
    },
    async createDevis(data) {
      const { data: cli, error: eCli } = await client().from("clients")
        .select("*").eq("id", data.clientId).maybeSingle();
      boom(eCli);
      if (!cli) throw new Error("Client introuvable");
      const row = {
        entreprise_id: entrepriseId,
        client_id: data.clientId,
        titre: data.titre,
        statut: "brouillon",
        client_snapshot: cli,
      };
      const { data: cree, error } = await client().from("devis").insert(row).select().single();
      boom(error);
      return mapDevis(cree);
    },
    async addDevisLigne(devisId, ligne) {
      const { data: existantes, error: eList } = await client().from("devis_lignes")
        .select("id").eq("devis_id", devisId);
      boom(eList);
      const row = {
        entreprise_id: entrepriseId,
        devis_id: devisId,
        catalog_item_id: ligne.catalogItemId || null,
        position: (existantes || []).length + 1,
        libelle_snapshot: ligne.libelle,
        description_snapshot: ligne.description || "",
        unite_snapshot: ligne.unite || "u",
        quantite: ligne.quantite,
        prix_unitaire_ht: ligne.prixUnitaireHT,
        taux_tva: ligne.tauxTVA,
      };
      const { data, error } = await client().from("devis_lignes").insert(row).select().single();
      boom(error);
      await recalculerTotauxDevis(devisId);
      return mapDevisLigne(data);
    },
    async deleteDevisLigne(ligneId) {
      const { data: ligne, error: eGet } = await client().from("devis_lignes")
        .select("devis_id").eq("id", ligneId).maybeSingle();
      boom(eGet);
      if (!ligne) throw new Error("Ligne introuvable");
      const { error } = await client().from("devis_lignes").delete().eq("id", ligneId);
      boom(error);
      await recalculerTotauxDevis(ligne.devis_id);
      return true;
    },
    async changerStatutDevis(devisId, statut, auteurId) {
      const patch = { statut };
      const maintenant = new Date().toISOString();
      if (statut === "valide") { patch.valide_le = maintenant; patch.valide_par = auteurId || null; }
      if (statut === "brouillon") { patch.valide_le = null; patch.valide_par = null; }
      if (statut === "envoye") patch.envoye_le = maintenant;
      if (statut === "accepte" || statut === "refuse") patch.repondu_le = maintenant;
      const { data, error } = await client().from("devis")
        .update(patch).eq("id", devisId).select().single();
      boom(error);
      return mapDevis(data);
    },

    // --- Facture (PALIER 2) ---
    // L'émission passe par la fonction PostgreSQL emettre_facture() : c'est
    // elle qui attribue le numéro sous verrou de ligne. Le navigateur ne
    // numérote JAMAIS, sans quoi la contiguïté ne vaudrait rien.
    async getParametresFacturation() {
      const { data, error } = await client().from("parametres_facturation")
        .select("*").maybeSingle();
      boom(error);
      return data ? mapParametres(data) : null;
    },
    async saveParametresFacturation(patch) {
      const row = {
        entreprise_id: entrepriseId,
        vendeur_snapshot: patch.vendeurSnapshot || {},
        conditions_paiement: patch.conditionsPaiement,
        penalites_retard: patch.penalitesRetard,
        indemnite_recouvrement: 40,
        mention_tva: patch.mentionTva || null,
      };
      const { data, error } = await client().from("parametres_facturation")
        .upsert(row, { onConflict: "entreprise_id" }).select().single();
      boom(error);
      return mapParametres(data);
    },
    async listFactures() {
      const { data, error } = await client().from("factures").select("*")
        .order("created_at", { ascending: false });
      boom(error);
      return (data || []).map(mapFacture);
    },
    async getFacture(id) {
      const { data, error } = await client().from("factures").select("*").eq("id", id).maybeSingle();
      boom(error);
      if (!data) return null;
      const [{ data: lignes, error: e2 }, { data: paiements, error: e3 }] = await Promise.all([
        client().from("facture_lignes").select("*").eq("facture_id", id).order("position"),
        client().from("facture_paiements").select("*").eq("facture_id", id),
      ]);
      boom(e2); boom(e3);
      const facture = mapFacture(data);
      const paye = arrondir((paiements || []).reduce((s, p) => s + Number(p.montant), 0));
      return Object.assign(facture, {
        lignes: (lignes || []).map(mapFactureLigne),
        paiements: (paiements || []).map(mapPaiement),
        totalPaye: paye,
        reste: arrondir(facture.totalTTC - paye),
      });
    },
    async creerFactureDepuisDevis(devisId) {
      const devis = await this.getDevis(devisId);
      if (!devis) throw new Error("Devis introuvable");
      if (devis.statut !== "accepte") throw new Error("Seul un devis accepté peut devenir une facture");
      const { data: cli, error: eCli } = await client().from("clients")
        .select("*").eq("id", devis.clientId).maybeSingle();
      boom(eCli);
      if (!cli) throw new Error("Client introuvable");
      const params = await this.getParametresFacturation();
      if (!params) throw new Error("Renseignez d'abord les paramètres de facturation");

      const { data: creee, error } = await client().from("factures").insert({
        entreprise_id: entrepriseId,
        client_id: devis.clientId,
        devis_id: devisId,
        genre: "facture",
        statut: "brouillon",
        client_snapshot: {
          nom: cli.display_name, kind: cli.kind, adresse: cli.billing_address_line1,
          codePostal: cli.billing_postal_code, ville: cli.billing_city,
        },
        vendeur_snapshot: params.vendeurSnapshot,
        conditions_paiement: params.conditionsPaiement,
        penalites_retard: params.penalitesRetard,
        indemnite_recouvrement: cli.kind === "company" ? 40 : null,
        mention_tva: params.mentionTva,
      }).select().single();
      boom(error);

      const lignes = devis.lignes.map((l, i) => ({
        entreprise_id: entrepriseId, facture_id: creee.id, catalog_item_id: l.catalogItemId,
        position: i + 1, libelle_snapshot: l.libelleSnapshot,
        description_snapshot: l.descriptionSnapshot, unite_snapshot: l.uniteSnapshot,
        quantite: l.quantite, prix_unitaire_ht: l.prixUnitaireHT, taux_tva: l.tauxTVA,
      }));
      if (lignes.length) {
        const { error: eL } = await client().from("facture_lignes").insert(lignes);
        boom(eL);
      }
      await recalculerTotauxFacture(creee.id);
      return mapFacture(creee);
    },
    async addFactureLigne(factureId, ligne) {
      const { data: existantes, error: eList } = await client().from("facture_lignes")
        .select("id").eq("facture_id", factureId);
      boom(eList);
      const { data, error } = await client().from("facture_lignes").insert({
        entreprise_id: entrepriseId, facture_id: factureId,
        catalog_item_id: ligne.catalogItemId || null,
        position: (existantes || []).length + 1,
        libelle_snapshot: ligne.libelle, description_snapshot: ligne.description || "",
        unite_snapshot: ligne.unite || "u", quantite: ligne.quantite,
        prix_unitaire_ht: ligne.prixUnitaireHT, taux_tva: ligne.tauxTVA,
      }).select().single();
      boom(error);
      await recalculerTotauxFacture(factureId);
      return mapFactureLigne(data);
    },
    async deleteFactureLigne(ligneId) {
      const { data: ligne, error: eGet } = await client().from("facture_lignes")
        .select("facture_id").eq("id", ligneId).maybeSingle();
      boom(eGet);
      if (!ligne) throw new Error("Ligne introuvable");
      const { error } = await client().from("facture_lignes").delete().eq("id", ligneId);
      boom(error);
      await recalculerTotauxFacture(ligne.facture_id);
      return true;
    },
    async changerStatutFacture(factureId, statut, auteurId) {
      if (statut === "emise") throw new Error("Utilisez emettreFacture() pour émettre");
      const patch = { statut };
      const maintenant = new Date().toISOString();
      if (statut === "valide") { patch.valide_le = maintenant; patch.valide_par = auteurId || null; }
      if (statut === "brouillon") { patch.valide_le = null; patch.valide_par = null; }
      if (statut === "annulee") patch.annulee_le = maintenant;
      const { data, error } = await client().from("factures")
        .update(patch).eq("id", factureId).select().single();
      boom(error);
      return mapFacture(data);
    },
    async emettreFacture(factureId) {
      const { data, error } = await client().rpc("emettre_facture", { p_facture_id: factureId });
      boom(error);
      const ligne = Array.isArray(data) ? data[0] : data;
      if (!ligne) throw new Error("Émission refusée");
      return mapFacture(ligne);
    },
    // --- Relances (PALIER 3) ---
    // Les verrous durs (annulation définitive, niveau 2 sans niveau 1,
    // message figé) sont des triggers PostgreSQL. Le client les respecte,
    // il ne les remplace pas.
    async getParametresRelance() {
      const { data, error } = await client().from("parametres_relance").select("*").maybeSingle();
      boom(error);
      return data ? mapParametresRelance(data) : {
        delaiDevis1: 5, delaiDevis2: 7, delaiFacture1: 30, delaiFacture2: 15, ton: "chaleureux",
      };
    },
    async saveParametresRelance(patch) {
      const { data, error } = await client().from("parametres_relance").upsert({
        entreprise_id: entrepriseId,
        delai_devis_1: patch.delaiDevis1, delai_devis_2: patch.delaiDevis2,
        delai_facture_1: patch.delaiFacture1, delai_facture_2: patch.delaiFacture2,
        ton: patch.ton,
      }, { onConflict: "entreprise_id" }).select().single();
      boom(error);
      return mapParametresRelance(data);
    },
    async listRelances() {
      const { data, error } = await client().from("relances").select("*")
        .order("prepare_le", { ascending: false });
      boom(error);
      return (data || []).map(mapRelance);
    },
    async ciblesARelancer(maintenant) {
      const p = await this.getParametresRelance();
      const [devis, factures, relances, clients] = await Promise.all([
        this.listDevis(), this.listFactures(), this.listRelances(), this.listClients(),
      ]);
      const nom = (id) => clients.find((c) => c.id === id) || null;
      const jours = (depuis) => {
        if (!depuis) return null;
        const d = new Date(depuis);
        if (isNaN(d.getTime())) return null;
        return Math.floor(((maintenant ? new Date(maintenant) : new Date()).getTime() - d.getTime()) / 86400000);
      };
      const out = [];
      const evaluer = (type, cible, depart, d1, d2, extra) => {
        const rs = relances.filter((r) => r.cibleType === type
          && (type === "devis" ? r.devisId : r.factureId) === cible.id);
        if (rs.some((r) => r.statut === "annulee")) return;
        if (rs.some((r) => r.niveau === 2)) return;
        if (rs.some((r) => r.statut === "preparee")) return;
        const n1 = rs.find((r) => r.niveau === 1);
        if (!n1) {
          const j = jours(depart);
          if (j !== null && j >= d1) out.push(Object.assign({ type, cible, niveau: 1, joursEcoules: j }, extra));
          return;
        }
        if (n1.statut !== "envoyee" || !n1.envoyeeLe) return;
        const j2 = jours(n1.envoyeeLe);
        if (j2 !== null && j2 >= d2) out.push(Object.assign({ type, cible, niveau: 2, joursEcoules: j2 }, extra));
      };
      devis.filter((d) => d.statut === "envoye").forEach((d) => {
        evaluer("devis", d, d.envoyeLe, p.delaiDevis1, p.delaiDevis2, { client: nom(d.clientId) });
      });
      for (const f of factures.filter((x) => x.statut === "emise")) {
        const complete = await this.getFacture(f.id);
        if (!complete || complete.reste <= 0) continue;
        evaluer("facture", f, f.dateEmission || f.emiseLe, p.delaiFacture1, p.delaiFacture2,
          { client: nom(f.clientId), reste: complete.reste });
      }
      return out;
    },
    async preparerRelance(cibleType, cibleId, niveau, message) {
      const { data, error } = await client().from("relances").insert({
        entreprise_id: entrepriseId,
        cible_type: cibleType,
        devis_id: cibleType === "devis" ? cibleId : null,
        facture_id: cibleType === "facture" ? cibleId : null,
        niveau, statut: "preparee", message,
      }).select().single();
      boom(error);
      return mapRelance(data);
    },
    async envoyerRelance(relanceId, auteurId) {
      const { data, error } = await client().from("relances").update({
        statut: "envoyee", envoyee_le: new Date().toISOString(), envoyee_par: auteurId || null,
      }).eq("id", relanceId).select().single();
      boom(error);
      return mapRelance(data);
    },
    async annulerRelance(relanceId) {
      const { data, error } = await client().from("relances").update({
        statut: "annulee", annulee_le: new Date().toISOString(),
      }).eq("id", relanceId).select().single();
      boom(error);
      return mapRelance(data);
    },

    async enregistrerPaiement(factureId, paiement) {
      const { data, error } = await client().from("facture_paiements").insert({
        entreprise_id: entrepriseId, facture_id: factureId,
        montant: paiement.montant, paye_le: paiement.payeLe || todayISO(),
        moyen: paiement.moyen || "virement", note: paiement.note || "",
      }).select().single();
      boom(error);
      // Solde atteint : la facture passe à payée.
      const facture = await this.getFacture(factureId);
      if (facture && facture.reste <= 0 && facture.statut === "emise") {
        const { error: eMaj } = await client().from("factures")
          .update({ statut: "payee" }).eq("id", factureId);
        boom(eMaj);
      }
      return mapPaiement(data);
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
        client_id: data.clientId || null,
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
        client_id: merged.clientId || null,
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
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "clients" }, cb)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "clients" }, cb)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "catalog_categories" }, cb)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "catalog_categories" }, cb)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "catalog_items" }, cb)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "catalog_items" }, cb)
          .subscribe();
      })();
      return { unsubscribe() { try { if (ch) c.removeChannel(ch); } catch (e) {} } };
    },
  };

  window.Chantier = window.Chantier || {};
  window.Chantier.backends = window.Chantier.backends || {};
  window.Chantier.backends.supabase = SupabaseBackend;
})();
