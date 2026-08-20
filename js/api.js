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
      // L'entreprise de démonstration exerce UN métier : seul son pack
      // s'affichera, les deux autres resteront masqués.
      entreprise: { nom: "Plomberie Martin", metier: "plombier" },
      employes: [
        { id: patronId, nom: "Vous (patron)", role: "patron", couleur: "#38bdf8" },
        { id: e1, nom: "Karim B.", role: "employe", couleur: "#f59e0b" },
        { id: e2, nom: "Lucas D.", role: "employe", couleur: "#34d399" },
      ],
      interventions: [
        {
          id: uid(), date: j, dateFin: addDays(j, 4), employeId: e1, statut: "a_faire", heure: "08:00",
          client: "M. et Mme Roux", adresse: "24 rue de la Republique, Le Creusot", tel: "0611223344",
          description: "Rénovation salle de bain complète : dépose de l'ancienne, plomberie, pose d'une douche à l'italienne, meuble et robinetterie.",
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
          description: "Rénovation complète de la cuisine : plomberie, évacuations, adoucisseur.",
        },
        {
          id: uid(), date: addDays(j, 40), dateFin: addDays(j, 40), employeId: e2, statut: "a_faire", heure: "10:00",
          client: "M. Fontaine", adresse: "6 chemin du Bois, Le Breuil", tel: "0699887766",
          description: "Entretien annuel chaudiere gaz.",
        },
      ],
      pointages: [], // { id, interventionId, employeId, debut, fin }
      clients: [
        {
          id: "client_roux", kind: "individual", displayName: "Famille Roux", legalName: "",
          siren: "", vatNumber: "", billingAddressLine1: "24 rue de la République",
          billingAddressLine2: "", billingPostalCode: "71200", billingCity: "Le Creusot",
          billingCountryCode: "FR",
        },
        {
          id: "client_boulangerie", kind: "company", displayName: "Boulangerie du Centre",
          legalName: "Boulangerie du Centre SARL", siren: "123456789", vatNumber: "FR00123456789",
          billingAddressLine1: "3 place du Marché", billingAddressLine2: "",
          billingPostalCode: "71200", billingCity: "Le Creusot", billingCountryCode: "FR",
        },
      ],
      catalogCategories: [
        { id: "cat_depannage", label: "Dépannage" },
        { id: "cat_installation", label: "Installation" },
      ],
      catalogItems: [
        {
          id: "item_diagnostic", categoryId: "cat_depannage", kind: "service", reference: "DEP-DIAG",
          label: "Diagnostic et recherche de panne", description: "Déplacement et première heure de diagnostic.",
          unit: "forfait", unitPriceExclTax: 95, vatRate: 10, purchasePriceExclTax: null,
        },
        {
          id: "item_pose_robinet", categoryId: "cat_installation", kind: "service", reference: "INST-ROB",
          label: "Pose d'une robinetterie", description: "Dépose, pose et essais, hors fourniture.",
          unit: "u", unitPriceExclTax: 120, vatRate: 10, purchasePriceExclTax: null,
        },
      ],
    };
  }

  // Fait évoluer les anciennes démonstrations locales sans perdre leurs chantiers.
  // Surtout, aucun client n'est rapproché automatiquement d'un texte historique.
  function normaliser(db) {
    const exemple = seed();
    if (!Array.isArray(db.clients)) db.clients = exemple.clients;
    if (!Array.isArray(db.catalogCategories)) db.catalogCategories = exemple.catalogCategories;
    if (!Array.isArray(db.catalogItems)) db.catalogItems = exemple.catalogItems;
    if (!Array.isArray(db.devis)) db.devis = [];
    if (!Array.isArray(db.devisLignes)) db.devisLignes = [];
    if (!Array.isArray(db.factures)) db.factures = [];
    if (!Array.isArray(db.factureLignes)) db.factureLignes = [];
    if (!Array.isArray(db.facturePaiements)) db.facturePaiements = [];
    if (!Array.isArray(db.sequencesDocuments)) db.sequencesDocuments = [];
    if (!Array.isArray(db.relances)) db.relances = [];
    if (!Array.isArray(db.stockEmplacements)) {
      db.stockEmplacements = [{ id: "empl_depot", libelle: "Dépôt", archiveLe: null }];
    }
    if (!Array.isArray(db.stockMouvements)) db.stockMouvements = [];
    if (!Array.isArray(db.facturesFournisseurs)) db.facturesFournisseurs = [];
    if (!Array.isArray(db.facturesFournisseursLignes)) db.facturesFournisseursLignes = [];
    if (!db.parametresRelance) {
      db.parametresRelance = {
        delaiDevis1: 5, delaiDevis2: 7,
        delaiFacture1: 30, delaiFacture2: 15,
        ton: "chaleureux",
      };
    }
    if (!db.parametresFacturation) {
      db.parametresFacturation = {
        vendeurSnapshot: {
          nom: "Plomberie Martin", siret: "", adresse: "", codePostal: "", ville: "",
        },
        conditionsPaiement: "Paiement à 30 jours.",
        penalitesRetard: "En cas de retard de paiement, pénalités au taux de 3 fois le taux d'intérêt légal.",
        indemniteRecouvrement: 40,
        mentionTva: "TVA non applicable, article 293 B du CGI",
        // Deux taux DIFFÉRENTS : ce qu'on facture, et ce que ça coûte.
        // La marge vit entre les deux.
        tauxHoraireVente: 45,
        coutHoraireInterne: 28,
        tvaMainOeuvre: 10,
      };
    }
    if (db.parametresFacturation.tauxHoraireVente == null) {
      db.parametresFacturation.tauxHoraireVente = 45;
      db.parametresFacturation.coutHoraireInterne = 28;
      db.parametresFacturation.tvaMainOeuvre = 10;
    }
    (db.interventions || []).forEach((i) => {
      if (!("devisId" in i)) i.devisId = null;
    });
    (db.interventions || []).forEach((i) => {
      if (!("clientId" in i)) i.clientId = null;
    });
    return db;
  }

  // --- Règles du devis, partagées par la démonstration et les tests ------
  // Elles reproduisent exactement les verrous de supabase/13_palier_1_devis.sql.
  const TRANSITIONS_DEVIS = {
    brouillon: ["valide"],
    valide: ["brouillon", "envoye"],
    envoye: ["accepte", "refuse"],
    accepte: [],
    refuse: [],
  };

  // Mêmes transitions que supabase/14_palier_2_facture.sql.
  // ⛔ "emise" ne mène JAMAIS à "annulee" : on corrige par un avoir.
  const TRANSITIONS_FACTURE = {
    brouillon: ["valide", "annulee"],
    valide: ["brouillon", "emise", "annulee"],
    emise: ["payee"],
    payee: [],
    annulee: [],
  };

  function arrondir(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  // Les totaux se recalculent TOUJOURS depuis les lignes, jamais à la main.
  function totauxDepuisLignes(lignes) {
    let ht = 0;
    let tva = 0;
    lignes.forEach((l) => {
      const ligneHT = arrondir(Number(l.quantite) * Number(l.prixUnitaireHT));
      ht += ligneHT;
      tva += arrondir(ligneHT * (Number(l.tauxTVA) / 100));
    });
    return { ht: arrondir(ht), tva: arrondir(tva), ttc: arrondir(ht + tva) };
  }

  function recalculerTotaux(db, devisId) {
    const d = db.devis.find((x) => x.id === devisId);
    if (!d) return;
    const t = totauxDepuisLignes(db.devisLignes.filter((l) => l.devisId === devisId));
    d.totalHT = t.ht; d.totalTVA = t.tva; d.totalTTC = t.ttc;
  }

  function recalculerTotauxFacture(db, factureId) {
    const f = db.factures.find((x) => x.id === factureId);
    if (!f) return;
    const t = totauxDepuisLignes(db.factureLignes.filter((l) => l.factureId === factureId));
    f.totalHT = t.ht; f.totalTVA = t.tva; f.totalTTC = t.ttc;
  }

  // Nombre de jours pleins écoulés depuis une date ISO ou un horodatage.
  function joursEcoules(depuis, maintenant) {
    if (!depuis) return null;
    const d = new Date(depuis);
    if (isNaN(d.getTime())) return null;
    const n = maintenant ? new Date(maintenant) : new Date();
    return Math.floor((n.getTime() - d.getTime()) / 86400000);
  }

  // Attribue le numéro suivant. En base, la contiguïté vient d'un verrou
  // de ligne ("for update") ; ici, le mode démonstration est mono-thread,
  // mais la règle de calcul est strictement la même.
  function numeroSuivant(db, entrepriseCle, annee) {
    let seq = db.sequencesDocuments.find((s) => s.cle === entrepriseCle && s.annee === annee);
    if (!seq) {
      seq = { cle: entrepriseCle, annee, prefixe: entrepriseCle === "AVOIR" ? "A" : "F", dernier: 0, largeur: 4 };
      db.sequencesDocuments.push(seq);
    }
    seq.dernier += 1;
    return seq.prefixe + annee + "-" + String(seq.dernier).padStart(seq.largeur, "0");
  }

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const db = normaliser(JSON.parse(raw));
        save(db);
        return db;
      }
    } catch (e) {
      // Une ecriture interrompue peut laisser un JSON illisible. On conserve
      // TOUJOURS la valeur brute avant de reinitialiser la demonstration :
      // elle pourra ainsi etre transmise au support et, si possible, recuperee.
      const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
      const cleSecours = STORE_KEY + ".corrompu." + horodatage;
      try {
        localStorage.setItem(cleSecours, raw == null ? "" : raw);
      } catch (sauvegardeError) {
        throw new Error("La sauvegarde locale est illisible et sa copie de secours a échoué. Rien n'a été remplacé. Libérez de l'espace puis rechargez l'application.");
      }
      const message = "La sauvegarde locale était illisible. Une copie a été conservée sous « "
        + cleSecours + " » avant de réinitialiser la démonstration.";
      if (typeof window.alert === "function") window.alert(message);
      else if (window.console && console.error) console.error(message, e);
    }
    // Le jeu de démonstration passe LUI AUSSI par normaliser : sans ça, les
    // collections ajoutées par les paliers successifs sont absentes au tout
    // premier appel, et le premier écran ouvert décide de ce qui plante.
    const fresh = normaliser(seed());
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


  // ---------------------------------------------------------------------
  // Amorcage du jeu de demonstration « gestion ».
  //
  // Le planning et l'equipe avaient leurs exemples, mais Devis, Factures,
  // Relances, Stock et Rentabilite s'ouvraient VIDES : un visiteur ne voyait
  // pas ce qu'il achete. On construit donc un dossier complet, en passant par
  // les vraies fonctions de l'API : les totaux, la numerotation et les
  // journaux sont calcules comme pour un vrai client, jamais ecrits a la main.
  // ---------------------------------------------------------------------
  async function amorcerGestionDemo(api) {
    const db = load();
    if (db.demoGestionAmorcee) return;

    // Marque AVANT le travail : si une etape echoue, on ne reessaie pas en
    // boucle a chaque ouverture de l'application.
    const d0 = load(); d0.demoGestionAmorcee = true; save(d0);

    try {
      const j = todayISO();
      const roux = "client_roux";
      const boulangerie = "client_boulangerie";

      // 1) Des fournitures, pour que le stock ait de la matiere.
      const mitigeur = await api.createCatalogItem({
        categoryId: "cat_installation", kind: "product", reference: "FOU-MIT",
        label: "Mitigeur thermostatique", description: "Mitigeur de douche, chromé.",
        unit: "u", unitPriceExclTax: 189, vatRate: 10, purchasePriceExclTax: 112,
      });
      const chauffeEau = await api.createCatalogItem({
        categoryId: "cat_installation", kind: "product", reference: "FOU-CE200",
        label: "Chauffe-eau 200 L", description: "Ballon électrique 200 litres.",
        unit: "u", unitPriceExclTax: 640, vatRate: 10, purchasePriceExclTax: 415,
      });
      const coude = await api.createCatalogItem({
        categoryId: "cat_installation", kind: "product", reference: "FOU-CU16",
        label: "Coude cuivre 16 mm", description: "Raccord à sertir.",
        unit: "u", unitPriceExclTax: 4.2, vatRate: 10, purchasePriceExclTax: 1.9,
      });

      // 2) Le chantier de la salle de bain : devis accepte, facture emise et
      //    impayee depuis plus d'un mois. C'est lui qui alimente les relances.
      const devisRoux = await api.createDevis({ clientId: roux, titre: "Rénovation complète salle de bain" });
      await api.addDevisLigne(devisRoux.id, {
        catalogItemId: "item_diagnostic", libelle: "Diagnostic et dépose de l'existant",
        quantite: 1, prixUnitaireHT: 95, tauxTVA: 10, unite: "forfait",
      });
      await api.addDevisLigne(devisRoux.id, {
        // La main d'oeuvre est vendue au TAUX HORAIRE DE L'ENTREPRISE
        // (parametresFacturation.tauxHoraireVente). Un devis a un autre prix
        // rendrait la comparaison devis / reel incomprehensible.
        catalogItemId: "item_pose_robinet", libelle: "Pose d'une douche à l'italienne et robinetterie",
        quantite: 20, prixUnitaireHT: 45, tauxTVA: 10, unite: "h",
      });
      await api.addDevisLigne(devisRoux.id, {
        catalogItemId: mitigeur.id, libelle: "Mitigeur thermostatique",
        quantite: 1, prixUnitaireHT: 189, tauxTVA: 10, unite: "u",
      });
      await api.changerStatutDevis(devisRoux.id, "valide", "u_patron");
      await api.changerStatutDevis(devisRoux.id, "envoye", "u_patron");
      await api.changerStatutDevis(devisRoux.id, "accepte", "u_patron");

      const factRoux = await api.creerFactureDepuisDevis(devisRoux.id);
      await api.changerStatutFacture(factRoux.id, "valide", "u_patron");
      await api.emettreFacture(factRoux.id);

      // 3) Un second devis parti sans reponse : la deuxieme situation que
      //    l'ecran Relances doit savoir reperer.
      const devisBoul = await api.createDevis({ clientId: boulangerie, titre: "Remplacement du chauffe-eau" });
      await api.addDevisLigne(devisBoul.id, {
        catalogItemId: chauffeEau.id, libelle: "Chauffe-eau 200 L, fourni et posé",
        quantite: 1, prixUnitaireHT: 640, tauxTVA: 10, unite: "u",
      });
      await api.addDevisLigne(devisBoul.id, {
        catalogItemId: "item_diagnostic", libelle: "Dépose de l'ancien ballon et mise en service",
        quantite: 1, prixUnitaireHT: 95, tauxTVA: 10, unite: "forfait",
      });
      await api.changerStatutDevis(devisBoul.id, "valide", "u_patron");
      await api.changerStatutDevis(devisBoul.id, "envoye", "u_patron");

      // 4) Le stock : des entrees au depot, puis ce qui est parti sur le
      //    chantier de la salle de bain.
      const interventions = load().interventions || [];
      const chantierRoux = interventions.find(function (i) {
        return JSON.stringify(i).indexOf("Roux") !== -1;
      }) || interventions[0];
      const empl = (load().stockEmplacements || [])[0];
      if (empl) {
        await api.ajouterMouvementStock({
          type: "entree", catalogItemId: mitigeur.id, emplacementId: empl.id,
          quantite: 4, prixUnitaire: 112, motif: "Réassort fournisseur", auteurId: "u_patron",
        });
        await api.ajouterMouvementStock({
          type: "entree", catalogItemId: chauffeEau.id, emplacementId: empl.id,
          quantite: 2, prixUnitaire: 415, motif: "Réassort fournisseur", auteurId: "u_patron",
        });
        await api.ajouterMouvementStock({
          type: "entree", catalogItemId: coude.id, emplacementId: empl.id,
          quantite: 50, prixUnitaire: 1.9, motif: "Réassort fournisseur", auteurId: "u_patron",
        });
        if (chantierRoux) {
          await api.ajouterMouvementStock({
            type: "consommation", catalogItemId: mitigeur.id, emplacementId: empl.id,
            quantite: -1, prixUnitaire: 112, interventionId: chantierRoux.id, motif: "Pose chez Roux", auteurId: "u_karim",
          });
          await api.ajouterMouvementStock({
            type: "consommation", catalogItemId: coude.id, emplacementId: empl.id,
            quantite: -8, prixUnitaire: 1.9, interventionId: chantierRoux.id, motif: "Réseau salle de bain", auteurId: "u_karim",
          });
        }
      }

      // 5) Une facture fournisseur deja importee et controlee.
      const doc = await api.importerFactureFournisseur({
        nom: "facture-cedeo-aout.pdf", typeMime: "application/pdf", tailleOctets: 184320,
      });
      await api.enregistrerExtraction(doc.id, {
        fournisseur: "Cédéo Le Creusot", numeroPiece: "FC-2026-4471",
        datePiece: addDays(j, -9), totalHT: 726.4, totalTTC: 871.68,
        confiances: { fournisseur: 0.97, numeroPiece: 0.93, datePiece: 0.95, totalHT: 0.99, totalTTC: 0.99 },
      });

      // 6) Les heures reellement pointees sur la salle de bain : sans elles,
      //    l'ecran Rentabilite ne peut rien calculer.
      if (chantierRoux) {
        if (api.rattacherChantierAuDevis) {
          await api.rattacherChantierAuDevis(chantierRoux.id, devisRoux.id);
        }
        const d2 = load();
        const pointage = function (empId, jour, hDebut, hFin) {
          return {
            id: uid(), interventionId: chantierRoux.id, employeId: empId,
            debut: addDays(j, jour) + "T" + hDebut + ":00",
            fin: addDays(j, jour) + "T" + hFin + ":00",
          };
        };
        d2.pointages.push(pointage("u_karim", -6, "08:00", "16:30"));
        d2.pointages.push(pointage("u_karim", -5, "08:00", "17:00"));
        d2.pointages.push(pointage("u_lucas", -5, "13:30", "17:30"));
        save(d2);
      }

      // 7) Antidatage : une facture emise aujourd'hui n'est en retard de rien,
      //    et un devis parti ce matin n'appelle aucune relance. On recule donc
      //    les dates pour que les ecrans montrent de vraies situations.
      const fin = load();
      const fr = fin.factures.find(function (f) { return f.id === factRoux.id; });
      if (fr) {
        // Les deux champs comptent : « dateEmission » sert au calcul des
        // relances, « emiseLe » a l'affichage.
        fr.dateEmission = addDays(j, -38);
        fr.emiseLe = addDays(j, -38) + "T09:00:00.000Z";
        if (fr.dateEcheance) fr.dateEcheance = addDays(j, -8);
        if (fr.echeanceLe) fr.echeanceLe = addDays(j, -8);
      }
      const dbBoul = fin.devis.find(function (d) { return d.id === devisBoul.id; });
      if (dbBoul) dbBoul.envoyeLe = addDays(j, -12);
      save(fin);
    } catch (e) {
      // Une demonstration incomplete ne doit jamais empecher l'application de
      // s'ouvrir : on trace et on continue.
      if (window.console && console.warn) {
        console.warn("Amorcage de la demonstration interrompu :", e && e.message);
      }
    }
  }

  const DemoBackend = {
    // Demarrage : rien de special en demo (les donnees sont locales).
    async init() { await amorcerGestionDemo(this); return true; },
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

    // --- Clients ---
    async listClients() {
      const db = load();
      const out = db.clients.slice().sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
      return delay(out);
    },
    async getClient(id) {
      const db = load();
      return delay(db.clients.find((c) => c.id === id) || null);
    },
    async createClient(data) {
      const db = load();
      const row = Object.assign({ id: uid() }, data);
      db.clients.push(row);
      save(db);
      return delay(row);
    },
    async updateClient(id, patch) {
      const db = load();
      const row = db.clients.find((c) => c.id === id);
      if (!row) throw new Error("Client introuvable");
      Object.assign(row, patch);
      save(db);
      return delay(row);
    },

    // --- Catalogue de prestations et matériaux ---
    async listCatalogCategories() {
      const db = load();
      return delay(db.catalogCategories.slice().sort((a, b) => a.label.localeCompare(b.label, "fr")));
    },
    async createCatalogCategory(data) {
      const db = load();
      const label = (data.label || "").trim();
      if (!label) throw new Error("Le nom de la catégorie est obligatoire");
      if (db.catalogCategories.some((c) => c.label.toLocaleLowerCase("fr") === label.toLocaleLowerCase("fr"))) {
        throw new Error("Cette catégorie existe déjà");
      }
      const row = { id: uid(), label };
      db.catalogCategories.push(row);
      save(db);
      return delay(row);
    },
    async listCatalogItems() {
      const db = load();
      return delay(db.catalogItems.slice().sort((a, b) => a.label.localeCompare(b.label, "fr")));
    },
    async getCatalogItem(id) {
      const db = load();
      return delay(db.catalogItems.find((i) => i.id === id) || null);
    },
    async createCatalogItem(data) {
      const db = load();
      const row = Object.assign({ id: uid() }, data);
      db.catalogItems.push(row);
      save(db);
      return delay(row);
    },
    async updateCatalogItem(id, patch) {
      const db = load();
      const row = db.catalogItems.find((i) => i.id === id);
      if (!row) throw new Error("Article de catalogue introuvable");
      Object.assign(row, patch);
      save(db);
      return delay(row);
    },
    async linkInterventionClient(interventionId, clientId) {
      const db = load();
      const intervention = db.interventions.find((i) => i.id === interventionId);
      if (!intervention) throw new Error("Intervention introuvable");
      if (!db.clients.some((c) => c.id === clientId)) throw new Error("Client introuvable");
      intervention.clientId = clientId;
      save(db);
      return delay(intervention);
    },

    // --- Devis (PALIER 1) ---
    // Validation humaine obligatoire : un devis ne part au client que s'il
    // est passé par le statut "valide", posé par un clic explicite.
    async listDevis() {
      const db = load();
      const out = db.devis.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return delay(out);
    },
    async getDevis(id) {
      const db = load();
      const d = db.devis.find((x) => x.id === id) || null;
      if (!d) return delay(null);
      const lignes = db.devisLignes
        .filter((l) => l.devisId === id)
        .sort((a, b) => a.position - b.position);
      return delay(Object.assign({}, d, { lignes }));
    },
    async createDevis(data) {
      const db = load();
      const titre = (data.titre || "").trim();
      if (!titre) throw new Error("Le titre du devis est obligatoire");
      const client = db.clients.find((c) => c.id === data.clientId);
      if (!client) throw new Error("Client introuvable");
      const row = {
        id: uid(),
        clientId: client.id,
        titre,
        statut: "brouillon",
        clientSnapshot: Object.assign({}, client),
        totalHT: 0, totalTVA: 0, totalTTC: 0,
        valideLe: null, validePar: null, envoyeLe: null, reponduLe: null,
        createdAt: new Date().toISOString(),
      };
      db.devis.push(row);
      save(db);
      return delay(row);
    },
    async addDevisLigne(devisId, ligne) {
      const db = load();
      const d = db.devis.find((x) => x.id === devisId);
      if (!d) throw new Error("Devis introuvable");
      if (d.statut !== "brouillon") throw new Error("Devis non modifiable : il est au statut " + d.statut);
      // ⛔ Un article de catalogue inventé est refusé, jamais silencieusement accepté.
      if (ligne.catalogItemId && !db.catalogItems.some((i) => i.id === ligne.catalogItemId)) {
        throw new Error("Article de catalogue introuvable");
      }
      const quantite = Number(ligne.quantite);
      if (!(quantite > 0)) throw new Error("La quantité doit être supérieure à zéro");
      const libelle = (ligne.libelle || "").trim();
      if (!libelle) throw new Error("Le libellé de la ligne est obligatoire");
      if ([0, 5.5, 10, 20].indexOf(Number(ligne.tauxTVA)) === -1) {
        throw new Error("Taux de TVA non autorisé");
      }
      const dejaLa = db.devisLignes.filter((l) => l.devisId === devisId);
      const row = {
        id: uid(),
        devisId,
        catalogItemId: ligne.catalogItemId || null,
        position: dejaLa.length + 1,
        libelleSnapshot: libelle,
        descriptionSnapshot: (ligne.description || "").trim(),
        uniteSnapshot: (ligne.unite || "u").trim(),
        quantite,
        prixUnitaireHT: Math.max(0, Number(ligne.prixUnitaireHT) || 0),
        tauxTVA: Number(ligne.tauxTVA),
      };
      db.devisLignes.push(row);
      recalculerTotaux(db, devisId);
      save(db);
      return delay(row);
    },
    async deleteDevisLigne(ligneId) {
      const db = load();
      const l = db.devisLignes.find((x) => x.id === ligneId);
      if (!l) throw new Error("Ligne introuvable");
      const d = db.devis.find((x) => x.id === l.devisId);
      if (d && d.statut !== "brouillon") throw new Error("Devis non modifiable : il est au statut " + d.statut);
      db.devisLignes = db.devisLignes.filter((x) => x.id !== ligneId);
      db.devisLignes
        .filter((x) => x.devisId === l.devisId)
        .sort((a, b) => a.position - b.position)
        .forEach((x, i) => { x.position = i + 1; });
      recalculerTotaux(db, l.devisId);
      save(db);
      return delay(true);
    },
    // Change le statut. C'est le SEUL chemin, et il refuse toute
    // transition non prevue, comme le trigger SQL.
    async changerStatutDevis(devisId, statut, auteurId) {
      const db = load();
      const d = db.devis.find((x) => x.id === devisId);
      if (!d) throw new Error("Devis introuvable");
      const permis = TRANSITIONS_DEVIS[d.statut] || [];
      if (permis.indexOf(statut) === -1) {
        throw new Error("Transition de devis interdite : " + d.statut + " vers " + statut);
      }
      if (statut === "valide") {
        const lignes = db.devisLignes.filter((l) => l.devisId === devisId);
        if (!lignes.length) throw new Error("Un devis vide ne peut pas être validé");
        d.valideLe = new Date().toISOString();
        d.validePar = auteurId || null;
      }
      if (statut === "brouillon") { d.valideLe = null; d.validePar = null; }
      if (statut === "envoye") {
        if (!d.valideLe) throw new Error("Envoi refusé : le devis n'a pas été validé par un humain");
        d.envoyeLe = new Date().toISOString();
      }
      if (statut === "accepte" || statut === "refuse") d.reponduLe = new Date().toISOString();
      d.statut = statut;
      save(db);
      return delay(d);
    },

    // --- Facture (PALIER 2) ---
    async getParametresFacturation() {
      const db = load();
      return delay(Object.assign({}, db.parametresFacturation));
    },
    async saveParametresFacturation(patch) {
      const db = load();
      Object.assign(db.parametresFacturation, patch);
      // L'indemnité de recouvrement B2B est fixée à 40 € par la loi.
      db.parametresFacturation.indemniteRecouvrement = 40;
      save(db);
      return delay(Object.assign({}, db.parametresFacturation));
    },
    async listFactures() {
      const db = load();
      return delay(db.factures.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
    },
    async getFacture(id) {
      const db = load();
      const f = db.factures.find((x) => x.id === id) || null;
      if (!f) return delay(null);
      const lignes = db.factureLignes.filter((l) => l.factureId === id).sort((a, b) => a.position - b.position);
      const paiements = db.facturePaiements.filter((p) => p.factureId === id);
      const paye = arrondir(paiements.reduce((s, p) => s + Number(p.montant), 0));
      // ⭐ Un avoir émis réduit ce que le client doit. Sans ça, on
      // relancerait sur un montant déjà corrigé.
      const avoirs = arrondir(db.factures
        .filter((a) => a.avoirDe === id && (a.statut === "emise" || a.statut === "payee"))
        .reduce((s, a) => s + Number(a.totalTTC), 0));
      return delay(Object.assign({}, f, {
        lignes, paiements, totalPaye: paye, totalAvoirs: avoirs,
        reste: arrondir(f.totalTTC - paye - avoirs),
      }));
    },
    // Prépare une facture à partir d'un devis ACCEPTÉ. Les lignes sont
    // recopiées telles quelles : le devis reste intact.
    async creerFactureDepuisDevis(devisId) {
      const db = load();
      const d = db.devis.find((x) => x.id === devisId);
      if (!d) throw new Error("Devis introuvable");
      if (d.statut !== "accepte") throw new Error("Seul un devis accepté peut devenir une facture");
      if (db.factures.some((f) => f.devisId === devisId && f.genre !== "avoir" && f.statut !== "annulee")) {
        throw new Error("Une facture existe déjà pour ce devis");
      }
      const client = db.clients.find((c) => c.id === d.clientId);
      if (!client) throw new Error("Client introuvable");
      const p = db.parametresFacturation;
      const facture = {
        id: uid(),
        clientId: d.clientId,
        devisId,
        genre: "facture",
        numero: null,
        statut: "brouillon",
        dateEmission: null,
        clientSnapshot: { nom: client.displayName, kind: client.kind, adresse: client.billingAddressLine1, codePostal: client.billingPostalCode, ville: client.billingCity },
        vendeurSnapshot: Object.assign({}, p.vendeurSnapshot),
        contenuSnapshot: null,
        conditionsPaiement: p.conditionsPaiement,
        penalitesRetard: p.penalitesRetard,
        indemniteRecouvrement: client.kind === "company" ? 40 : null,
        mentionTva: p.mentionTva,
        totalHT: 0, totalTVA: 0, totalTTC: 0,
        valideLe: null, validePar: null, emiseLe: null, annuleeLe: null,
        createdAt: new Date().toISOString(),
      };
      db.factures.push(facture);
      db.devisLignes.filter((l) => l.devisId === devisId).sort((a, b) => a.position - b.position)
        .forEach((l, i) => {
          db.factureLignes.push({
            id: uid(), factureId: facture.id, catalogItemId: l.catalogItemId,
            position: i + 1, libelleSnapshot: l.libelleSnapshot,
            descriptionSnapshot: l.descriptionSnapshot, uniteSnapshot: l.uniteSnapshot,
            quantite: l.quantite, prixUnitaireHT: l.prixUnitaireHT, tauxTVA: l.tauxTVA,
          });
        });
      recalculerTotauxFacture(db, facture.id);
      save(db);
      return delay(facture);
    },
    async addFactureLigne(factureId, ligne) {
      const db = load();
      const f = db.factures.find((x) => x.id === factureId);
      if (!f) throw new Error("Facture introuvable");
      if (f.statut !== "brouillon") throw new Error("Facture non modifiable : elle est au statut " + f.statut);
      const quantite = Number(ligne.quantite);
      if (!(quantite > 0)) throw new Error("La quantité doit être supérieure à zéro");
      const libelle = (ligne.libelle || "").trim();
      if (!libelle) throw new Error("Le libellé de la ligne est obligatoire");
      if ([0, 5.5, 10, 20].indexOf(Number(ligne.tauxTVA)) === -1) throw new Error("Taux de TVA non autorisé");
      const row = {
        id: uid(), factureId, catalogItemId: ligne.catalogItemId || null,
        position: db.factureLignes.filter((l) => l.factureId === factureId).length + 1,
        libelleSnapshot: libelle, descriptionSnapshot: (ligne.description || "").trim(),
        uniteSnapshot: (ligne.unite || "u").trim(), quantite,
        prixUnitaireHT: Math.max(0, Number(ligne.prixUnitaireHT) || 0), tauxTVA: Number(ligne.tauxTVA),
      };
      db.factureLignes.push(row);
      recalculerTotauxFacture(db, factureId);
      save(db);
      return delay(row);
    },
    async deleteFactureLigne(ligneId) {
      const db = load();
      const l = db.factureLignes.find((x) => x.id === ligneId);
      if (!l) throw new Error("Ligne introuvable");
      const f = db.factures.find((x) => x.id === l.factureId);
      if (f && f.statut !== "brouillon") throw new Error("Facture non modifiable : elle est au statut " + f.statut);
      db.factureLignes = db.factureLignes.filter((x) => x.id !== ligneId);
      db.factureLignes.filter((x) => x.factureId === l.factureId)
        .sort((a, b) => a.position - b.position).forEach((x, i) => { x.position = i + 1; });
      recalculerTotauxFacture(db, l.factureId);
      save(db);
      return delay(true);
    },
    async changerStatutFacture(factureId, statut, auteurId) {
      const db = load();
      const f = db.factures.find((x) => x.id === factureId);
      if (!f) throw new Error("Facture introuvable");
      const permis = TRANSITIONS_FACTURE[f.statut] || [];
      if (permis.indexOf(statut) === -1) {
        if (f.statut === "emise" && statut === "annulee") {
          throw new Error("Facture déjà émise : corrigez-la par un avoir, pas par une annulation");
        }
        throw new Error("Transition de facture interdite : " + f.statut + " vers " + statut);
      }
      if (statut === "valide") {
        if (!db.factureLignes.some((l) => l.factureId === factureId)) {
          throw new Error("Une facture vide ne peut pas être validée");
        }
        f.valideLe = new Date().toISOString();
        f.validePar = auteurId || null;
      }
      if (statut === "brouillon") { f.valideLe = null; f.validePar = null; }
      if (statut === "annulee") f.annuleeLe = new Date().toISOString();
      if (statut === "emise") throw new Error("Utilisez emettreFacture() pour émettre");
      f.statut = statut;
      save(db);
      return delay(f);
    },
    // ⭐ Le SEUL chemin qui attribue un numéro. Mêmes contrôles que la
    // fonction PostgreSQL emettre_facture().
    async emettreFacture(factureId) {
      const db = load();
      const f = db.factures.find((x) => x.id === factureId);
      if (!f) throw new Error("Facture introuvable");
      if (f.statut !== "valide") {
        throw new Error("Seule une facture validée peut être émise (statut actuel : " + f.statut + ")");
      }
      if (!f.valideLe) throw new Error("Émission refusée : la facture n'a pas été validée par un humain");
      const lignes = db.factureLignes.filter((l) => l.factureId === factureId);
      if (!lignes.length) throw new Error("Une facture sans ligne ne peut pas être émise");
      if (!String(f.vendeurSnapshot && f.vendeurSnapshot.nom || "").trim()) {
        throw new Error("Identité du vendeur manquante : renseignez les paramètres de facturation");
      }
      if (!String(f.clientSnapshot && f.clientSnapshot.nom || "").trim()) {
        throw new Error("Identité du client manquante");
      }
      // Mentions B2B obligatoires (article L441-10 du code de commerce).
      if (f.clientSnapshot.kind === "company"
          && (!String(f.penalitesRetard || "").trim() || Number(f.indemniteRecouvrement) !== 40)) {
        throw new Error("Client professionnel : pénalités de retard et indemnité de 40 € obligatoires");
      }

      const annee = new Date().getFullYear();
      f.numero = numeroSuivant(db, f.genre === "avoir" ? "AVOIR" : "FACTURE", annee);
      f.statut = "emise";
      f.emiseLe = new Date().toISOString();
      f.dateEmission = f.dateEmission || todayISO();
      f.contenuSnapshot = {
        version: 1,
        vendeur: f.vendeurSnapshot,
        client: f.clientSnapshot,
        lignes: lignes.map((l) => Object.assign({}, l)),
        conditionsPaiement: f.conditionsPaiement,
        penalitesRetard: f.penalitesRetard,
        indemniteRecouvrement: f.indemniteRecouvrement,
        mentionTva: f.mentionTva,
        totaux: { ht: f.totalHT, tva: f.totalTVA, ttc: f.totalTTC },
      };
      save(db);
      return delay(f);
    },
    async enregistrerPaiement(factureId, paiement) {
      const db = load();
      const f = db.factures.find((x) => x.id === factureId);
      if (!f) throw new Error("Facture introuvable");
      if (f.statut !== "emise") throw new Error("Seule une facture émise peut recevoir un paiement");
      const montant = arrondir(paiement.montant);
      if (!(montant > 0)) throw new Error("Le montant doit être supérieur à zéro");
      const dejaPaye = arrondir(db.facturePaiements.filter((p) => p.factureId === factureId)
        .reduce((s, p) => s + Number(p.montant), 0));
      if (arrondir(dejaPaye + montant) > f.totalTTC) {
        throw new Error("Le total des paiements dépasserait le montant de la facture");
      }
      const row = {
        id: uid(), factureId, montant,
        payeLe: paiement.payeLe || todayISO(),
        moyen: paiement.moyen || "virement",
        note: (paiement.note || "").trim(),
      };
      db.facturePaiements.push(row);
      if (arrondir(dejaPaye + montant) === f.totalTTC) f.statut = "payee";
      save(db);
      return delay(row);
    },

    // --- L'AVOIR ---
    // Une facture émise est immuable. On ne la modifie pas, on ne l'annule
    // pas : on émet un avoir qui la corrige, en tout ou en partie.
    async creerAvoir(factureId, lignes) {
      const db = load();
      const origine = db.factures.find((f) => f.id === factureId);
      if (!origine) throw new Error("Facture à corriger introuvable");
      if (origine.statut !== "emise" && origine.statut !== "payee") {
        throw new Error("Seule une facture émise se corrige par un avoir (statut actuel : " + origine.statut + ")");
      }
      if (origine.genre === "avoir") throw new Error("Un avoir ne se corrige pas par un autre avoir");
      if (!Array.isArray(lignes) || !lignes.length) {
        throw new Error("Aucune ligne : rien à corriger");
      }

      const avoir = {
        id: uid(), clientId: origine.clientId, devisId: origine.devisId,
        genre: "avoir", avoirDe: factureId, origine: origine.origine || "devis",
        numero: null, statut: "brouillon", dateEmission: null,
        clientSnapshot: Object.assign({}, origine.clientSnapshot),
        vendeurSnapshot: Object.assign({}, origine.vendeurSnapshot),
        contenuSnapshot: null,
        conditionsPaiement: origine.conditionsPaiement,
        penalitesRetard: origine.penalitesRetard,
        indemniteRecouvrement: origine.indemniteRecouvrement,
        mentionTva: origine.mentionTva,
        totalHT: 0, totalTVA: 0, totalTTC: 0,
        valideLe: null, validePar: null, emiseLe: null, annuleeLe: null,
        createdAt: new Date().toISOString(),
      };
      db.factures.push(avoir);
      save(db);

      for (let i = 0; i < lignes.length; i += 1) {
        await this.addFactureLigne(avoir.id, lignes[i]);
      }

      // On ne rembourse jamais plus qu'on n'a facturé.
      const apres = load();
      const cree = apres.factures.find((f) => f.id === avoir.id);
      const deja = arrondir(apres.factures
        .filter((a) => a.avoirDe === factureId && a.id !== avoir.id
          && (a.statut === "emise" || a.statut === "payee"))
        .reduce((s, a) => s + Number(a.totalTTC), 0));
      if (arrondir(deja + cree.totalTTC) > arrondir(origine.totalTTC)) {
        // On retire l'avoir en trop plutôt que de laisser un brouillon faux.
        apres.factures = apres.factures.filter((f) => f.id !== avoir.id);
        apres.factureLignes = apres.factureLignes.filter((l) => l.factureId !== avoir.id);
        save(apres);
        throw new Error("Le total des avoirs (" + arrondir(deja + cree.totalTTC)
          + " €) dépasserait la facture (" + arrondir(origine.totalTTC) + " €)");
      }
      return delay(cree);
    },
    // Ce qui reste RÉELLEMENT dû : facturé, moins payé, moins les avoirs.
    async soldeFacture(factureId) {
      const db = load();
      const f = db.factures.find((x) => x.id === factureId);
      if (!f) throw new Error("Facture introuvable");
      const paye = arrondir(db.facturePaiements
        .filter((p) => p.factureId === factureId).reduce((s, p) => s + Number(p.montant), 0));
      const avoirs = arrondir(db.factures
        .filter((a) => a.avoirDe === factureId && (a.statut === "emise" || a.statut === "payee"))
        .reduce((s, a) => s + Number(a.totalTTC), 0));
      return delay({
        totalTTC: f.totalTTC, totalPaye: paye, totalAvoirs: avoirs,
        resteDu: arrondir(f.totalTTC - paye - avoirs),
      });
    },
    async listAvoirsDe(factureId) {
      const db = load();
      return delay(db.factures.filter((a) => a.avoirDe === factureId));
    },

    // --- Relances (PALIER 3) ---
    async getParametresRelance() {
      const db = load();
      return delay(Object.assign({}, db.parametresRelance));
    },
    async saveParametresRelance(patch) {
      const db = load();
      const p = db.parametresRelance;
      ["delaiDevis1", "delaiDevis2", "delaiFacture1", "delaiFacture2"].forEach((cle) => {
        if (cle in patch) {
          const v = Number(patch[cle]);
          if (!Number.isInteger(v) || v < 1) throw new Error("Les délais doivent être des entiers positifs");
          p[cle] = v;
        }
      });
      if (patch.ton === "direct" || patch.ton === "chaleureux") p.ton = patch.ton;
      save(db);
      return delay(Object.assign({}, p));
    },
    async listRelances() {
      const db = load();
      return delay(db.relances.slice().sort((a, b) => String(b.prepareLe).localeCompare(String(a.prepareLe))));
    },
    // ⭐ Le moteur de décision : QUI mérite une relance aujourd'hui.
    // Il ne prépare rien, il ne fait que dire ce qui est dû.
    async ciblesARelancer(maintenant) {
      const db = load();
      const p = db.parametresRelance;
      const out = [];

      const relancesDe = (type, id) => db.relances.filter((r) =>
        r.cibleType === type && (type === "devis" ? r.devisId : r.factureId) === id);

      const evaluer = (type, cible, dateDepart, delai1, delai2, extra) => {
        const rs = relancesDe(type, cible.id);
        // ⛔ Une annulation ferme la cible pour de bon.
        if (rs.some((r) => r.statut === "annulee")) return;
        if (rs.some((r) => r.niveau === 2)) return;      // deux niveaux au maximum
        if (rs.some((r) => r.statut === "preparee")) return; // une seule en attente

        const n1 = rs.find((r) => r.niveau === 1);
        if (!n1) {
          const j = joursEcoules(dateDepart, maintenant);
          if (j !== null && j >= delai1) {
            out.push(Object.assign({ type, cible, niveau: 1, joursEcoules: j }, extra));
          }
          return;
        }
        if (n1.statut !== "envoyee" || !n1.envoyeeLe) return;
        const j2 = joursEcoules(n1.envoyeeLe, maintenant);
        if (j2 !== null && j2 >= delai2) {
          out.push(Object.assign({ type, cible, niveau: 2, joursEcoules: j2 }, extra));
        }
      };

      db.devis.forEach((d) => {
        if (d.statut !== "envoye") return;   // ni accepté, ni refusé, ni brouillon
        const client = db.clients.find((c) => c.id === d.clientId);
        evaluer("devis", d, d.envoyeLe, p.delaiDevis1, p.delaiDevis2, { client: client || null });
      });

      db.factures.forEach((f) => {
        if (f.statut !== "emise") return;    // ni brouillon, ni payée
        if (f.genre === "avoir") return;     // un avoir ne se relance pas
        const paye = arrondir(db.facturePaiements.filter((x) => x.factureId === f.id)
          .reduce((s, x) => s + Number(x.montant), 0));
        // ⭐ Les avoirs émis réduisent la dette : on ne relance jamais sur
        // un montant déjà corrigé.
        const avoirs = arrondir(db.factures
          .filter((a) => a.avoirDe === f.id && (a.statut === "emise" || a.statut === "payee"))
          .reduce((s, a) => s + Number(a.totalTTC), 0));
        const reste = arrondir(f.totalTTC - paye - avoirs);
        if (reste <= 0) return;
        const client = db.clients.find((c) => c.id === f.clientId);
        evaluer("facture", f, f.dateEmission || f.emiseLe, p.delaiFacture1, p.delaiFacture2,
          { client: client || null, reste });
      });

      return delay(out);
    },
    // Enregistre la proposition. Elle N'EST PAS envoyée à ce stade.
    async preparerRelance(cibleType, cibleId, niveau, message) {
      const db = load();
      if (cibleType !== "devis" && cibleType !== "facture") throw new Error("Cible de relance inconnue");
      const texte = String(message || "").trim();
      if (!texte) throw new Error("Le message de relance est obligatoire");
      if (niveau !== 1 && niveau !== 2) throw new Error("Niveau de relance invalide");

      const cible = cibleType === "devis"
        ? db.devis.find((x) => x.id === cibleId)
        : db.factures.find((x) => x.id === cibleId);
      if (!cible) throw new Error("Cible introuvable");

      const rs = db.relances.filter((r) => r.cibleType === cibleType
        && (cibleType === "devis" ? r.devisId : r.factureId) === cibleId);
      if (rs.some((r) => r.statut === "annulee")) {
        throw new Error("Relance annulée définitivement : cette cible ne se relance plus");
      }
      if (rs.some((r) => r.niveau === niveau)) {
        throw new Error("Une relance de niveau " + niveau + " existe déjà pour cette cible");
      }
      if (niveau === 2 && !rs.some((r) => r.niveau === 1 && r.statut === "envoyee")) {
        throw new Error("Deuxième relance impossible : la première n'a pas été envoyée");
      }

      const row = {
        id: uid(), cibleType,
        devisId: cibleType === "devis" ? cibleId : null,
        factureId: cibleType === "facture" ? cibleId : null,
        niveau, statut: "preparee", message: texte,
        prepareLe: new Date().toISOString(),
        envoyeeLe: null, envoyeePar: null, annuleeLe: null,
      };
      db.relances.push(row);
      save(db);
      return delay(row);
    },
    // Le clic humain. C'est seulement ici que la relance part.
    async envoyerRelance(relanceId, auteurId) {
      const db = load();
      const r = db.relances.find((x) => x.id === relanceId);
      if (!r) throw new Error("Relance introuvable");
      if (r.statut !== "preparee") {
        throw new Error("Transition de relance interdite : " + r.statut + " vers envoyee");
      }
      r.statut = "envoyee";
      r.envoyeeLe = new Date().toISOString();
      r.envoyeePar = auteurId || null;
      save(db);
      return delay(r);
    },
    // --- Factures fournisseurs (PALIER 7) ---
    // ⛔ Un document importé ne crée JAMAIS de dépense ni de mouvement de
    // stock tout seul. Il faut une validation humaine explicite.
    async importerFactureFournisseur(fichier) {
      const db = load();
      const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
      const nom = String(fichier.nom || "").trim();
      if (!nom) throw new Error("Nom de fichier manquant");
      if (TYPES.indexOf(fichier.typeMime) === -1) {
        throw new Error("Format non accepté : seuls PDF, JPEG, PNG et WebP sont traités");
      }
      const taille = Number(fichier.tailleOctets) || 0;
      if (taille <= 0) throw new Error("Fichier vide");
      if (taille > 20971520) throw new Error("Fichier trop lourd : 20 Mo au maximum");

      const row = {
        id: uid(), nomFichier: nom, typeMime: fichier.typeMime, tailleOctets: taille,
        statut: "importe", fournisseur: "", numeroPiece: "", datePiece: null,
        totalHT: null, totalTTC: null, confiances: {},
        valideLe: null, validePar: null, rejeteLe: null, motifRejet: "",
        createdAt: new Date().toISOString(),
      };
      db.facturesFournisseurs.push(row);
      save(db);
      return delay(row);
    },
    async listFacturesFournisseurs() {
      const db = load();
      return delay(db.facturesFournisseurs.slice()
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
    },
    async getFactureFournisseur(id) {
      const db = load();
      const d = db.facturesFournisseurs.find((x) => x.id === id) || null;
      if (!d) return delay(null);
      const lignes = db.facturesFournisseursLignes
        .filter((l) => l.documentId === id).sort((a, b) => a.position - b.position);
      return delay(Object.assign({}, d, { lignes }));
    },
    // Enregistre ce que l'extraction PROPOSE. Le document passe en
    // "extrait", c'est-à-dire EN ATTENTE de validation humaine.
    async enregistrerExtraction(documentId, extraction) {
      const db = load();
      const d = db.facturesFournisseurs.find((x) => x.id === documentId);
      if (!d) throw new Error("Document introuvable");
      if (d.statut === "valide") throw new Error("Document déjà validé : il est figé");
      if (d.statut === "rejete") throw new Error("Document rejeté");

      d.fournisseur = String(extraction.fournisseur || "").trim();
      d.numeroPiece = String(extraction.numeroPiece || "").trim();
      d.datePiece = extraction.datePiece || null;
      d.totalHT = extraction.totalHT == null ? null : arrondir(extraction.totalHT);
      d.totalTTC = extraction.totalTTC == null ? null : arrondir(extraction.totalTTC);
      d.confiances = extraction.confiances || {};
      d.statut = "extrait";

      db.facturesFournisseursLignes = db.facturesFournisseursLignes
        .filter((l) => l.documentId !== documentId);
      (extraction.lignes || []).forEach((l, i) => {
        // ⛔ Un article de catalogue inventé est refusé.
        if (l.catalogItemId && !db.catalogItems.some((c) => c.id === l.catalogItemId)) {
          throw new Error("Article de catalogue introuvable");
        }
        db.facturesFournisseursLignes.push({
          id: uid(), documentId, position: i + 1,
          libelle: String(l.libelle || "").trim() || "Ligne",
          quantite: Number(l.quantite) || 1,
          prixUnitaire: Math.max(0, Number(l.prixUnitaire) || 0),
          catalogItemId: l.catalogItemId || null,
          confiance: l.confiance || "a_verifier",
        });
      });
      save(db);
      return delay(d);
    },
    // ⭐ LA validation humaine. C'est seulement ici que le stock bouge,
    // et uniquement pour les lignes rattachées à un article du catalogue.
    async validerFactureFournisseur(documentId, options) {
      const db = load();
      const o = options || {};
      const d = db.facturesFournisseurs.find((x) => x.id === documentId);
      if (!d) throw new Error("Document introuvable");
      if (d.statut !== "extrait") {
        throw new Error("Transition de document interdite : " + d.statut + " vers valide");
      }
      const lignes = db.facturesFournisseursLignes.filter((l) => l.documentId === documentId);
      if (!lignes.length) throw new Error("Aucune ligne : rien à valider");
      const orphelines = lignes.filter((l) => !l.catalogItemId);
      if (orphelines.length && !o.accepterOrphelines) {
        throw new Error(orphelines.length + " ligne(s) ne sont rattachées à aucun article du catalogue. Rattachez-les ou confirmez de les ignorer.");
      }
      if (!o.emplacementId) throw new Error("Indiquez l'emplacement de réception");

      d.statut = "valide";
      d.valideLe = new Date().toISOString();
      d.validePar = o.auteurId || null;
      save(db);

      // Les lignes rattachées entrent réellement en stock.
      for (const l of lignes.filter((x) => x.catalogItemId)) {
        await this.ajouterMouvementStock({
          catalogItemId: l.catalogItemId,
          emplacementId: o.emplacementId,
          type: "entree",
          quantite: Math.abs(Number(l.quantite)),
          prixUnitaire: l.prixUnitaire,
          motif: "Facture " + (d.fournisseur || "fournisseur") + " " + (d.numeroPiece || ""),
          creePar: o.auteurId || null,
        });
      }
      return delay(await this.getFactureFournisseur(documentId));
    },
    async rejeterFactureFournisseur(documentId, motif) {
      const db = load();
      const d = db.facturesFournisseurs.find((x) => x.id === documentId);
      if (!d) throw new Error("Document introuvable");
      if (d.statut === "valide") throw new Error("Document déjà validé : il est figé");
      d.statut = "rejete";
      d.rejeteLe = new Date().toISOString();
      d.motifRejet = String(motif || "").trim();
      save(db);
      return delay(d);
    },

    // --- La facture issue du RÉEL (PALIER 5) ---
    // Rattache un chantier au devis dont il est issu. Sans ce lien, on ne
    // peut ni retrouver les heures, ni comparer le réel au prévu.
    async rattacherChantierAuDevis(interventionId, devisId) {
      const db = load();
      const i = db.interventions.find((x) => x.id === interventionId);
      if (!i) throw new Error("Chantier introuvable");
      if (devisId && !db.devis.some((d) => d.id === devisId)) {
        throw new Error("Devis étranger à l'entreprise");
      }
      i.devisId = devisId || null;
      save(db);
      return delay(i);
    },
    // Ce qui s'est RÉELLEMENT passé sur le chantier d'un devis :
    // heures pointées, et matériaux nets (posés moins retournés).
    async reelDuChantier(devisId) {
      const db = load();
      const interventions = db.interventions.filter((i) => i.devisId === devisId);
      const ids = interventions.map((i) => i.id);

      let heures = 0;
      db.pointages.forEach((p) => {
        if (ids.indexOf(p.interventionId) === -1 || !p.fin) return;
        heures += (new Date(p.fin).getTime() - new Date(p.debut).getTime()) / 3600000;
      });

      const parArticle = {};
      db.stockMouvements.forEach((m) => {
        if (ids.indexOf(m.interventionId) === -1) return;
        if (m.type !== "consommation" && m.type !== "retour") return;
        // Consommation négative, retour positif : l'opposé donne le net posé.
        const net = -Number(m.quantite);
        if (!parArticle[m.catalogItemId]) {
          parArticle[m.catalogItemId] = { catalogItemId: m.catalogItemId, quantite: 0, cout: 0, prixUnitaire: 0 };
        }
        parArticle[m.catalogItemId].quantite = arrondir(parArticle[m.catalogItemId].quantite + net);
        parArticle[m.catalogItemId].cout = arrondir(parArticle[m.catalogItemId].cout + net * (Number(m.prixUnitaire) || 0));
      });
      Object.keys(parArticle).forEach((k) => {
        const a = parArticle[k];
        a.prixUnitaire = a.quantite ? arrondir(a.cout / a.quantite) : 0;
      });

      return delay({
        devisId,
        heuresReelles: Math.round(heures * 100) / 100,
        materiaux: Object.keys(parArticle).map((k) => parArticle[k]).filter((a) => a.quantite !== 0),
        nbInterventions: interventions.length,
      });
    },
    // ⭐ La proposition de facture DEPUIS LE RÉEL, avec les écarts.
    // Elle N'ÉCRIT RIEN : c'est une proposition que l'humain arbitre.
    async proposerFactureReelle(devisId) {
      const db = load();
      const devis = db.devis.find((d) => d.id === devisId);
      if (!devis) throw new Error("Devis introuvable");
      if (devis.statut !== "accepte") throw new Error("Seul un devis accepté peut être facturé");
      const p = db.parametresFacturation;
      const reel = await this.reelDuChantier(devisId);
      const lignesDevis = db.devisLignes.filter((l) => l.devisId === devisId);

      const lignes = [];

      // 1) La main d'œuvre réellement pointée.
      if (reel.heuresReelles > 0) {
        lignes.push({
          origine: "heures",
          catalogItemId: null,
          libelle: "Main d'œuvre",
          unite: "h",
          quantite: reel.heuresReelles,
          prixUnitaireHT: Number(p.tauxHoraireVente),
          tauxTVA: Number(p.tvaMainOeuvre),
        });
      }

      // 2) Les matériaux réellement posés, au prix du catalogue s'il existe.
      reel.materiaux.forEach((m) => {
        const article = db.catalogItems.find((c) => c.id === m.catalogItemId);
        lignes.push({
          origine: "materiaux",
          catalogItemId: m.catalogItemId,
          libelle: article ? article.label : "Matériau",
          unite: article ? article.unit : "u",
          quantite: m.quantite,
          prixUnitaireHT: article ? Number(article.unitPriceExclTax) : m.prixUnitaire,
          tauxTVA: article ? Number(article.vatRate) : 10,
        });
      });

      const totalReel = totauxDepuisLignes(lignes.map((l) => ({
        quantite: l.quantite, prixUnitaireHT: l.prixUnitaireHT, tauxTVA: l.tauxTVA,
      })));
      const totalDevis = { ht: devis.totalHT, tva: devis.totalTVA, ttc: devis.totalTTC };

      // 3) Les ÉCARTS. C'est le vrai produit : on ne les cache pas.
      const ecarts = [];
      const ecartHT = arrondir(totalReel.ht - totalDevis.ht);
      if (ecartHT !== 0) {
        ecarts.push({
          type: ecartHT > 0 ? "depassement" : "economie",
          // Virgule décimale : c'est un texte français lu par l'artisan.
          libelle: (ecartHT > 0 ? "Le réel dépasse le devis de " : "Le réel est inférieur au devis de ")
            + Math.abs(ecartHT).toFixed(2).replace(".", ",") + " € HT",
          montant: ecartHT,
        });
      }
      if (reel.heuresReelles === 0 && !reel.materiaux.length) {
        ecarts.push({
          type: "vide",
          libelle: "Aucune heure pointée ni matériau consommé sur ce chantier. Rien à facturer depuis le réel.",
          montant: 0,
        });
      }
      // Un matériau posé mais absent du devis mérite d'être signalé.
      reel.materiaux.forEach((m) => {
        if (!lignesDevis.some((l) => l.catalogItemId === m.catalogItemId)) {
          const article = db.catalogItems.find((c) => c.id === m.catalogItemId);
          ecarts.push({
            type: "hors_devis",
            libelle: "« " + (article ? article.label : "Matériau") + " » a été posé mais n'était pas au devis",
            montant: 0,
          });
        }
      });

      // 4) La marge, avec le coût interne des heures.
      const coutMainOeuvre = arrondir(reel.heuresReelles * Number(p.coutHoraireInterne));
      const coutMateriaux = arrondir(reel.materiaux.reduce((s, m) => s + m.cout, 0));
      const marge = arrondir(totalReel.ht - coutMainOeuvre - coutMateriaux);

      return delay({
        devisId,
        lignes,
        reel,
        totalReel,
        totalDevis,
        ecarts,
        rentabilite: {
          chiffreAffairesHT: totalReel.ht,
          coutMainOeuvre,
          coutMateriaux,
          marge,
          tauxMarge: totalReel.ht > 0 ? Math.round((marge / totalReel.ht) * 1000) / 10 : 0,
        },
      });
    },
    // Crée la facture à partir des lignes ARBITRÉES par l'humain.
    // ⛔ Elle ne prend PAS la proposition telle quelle : elle prend ce que
    // l'artisan a validé, ligne par ligne.
    async creerFactureDepuisReel(devisId, lignesValidees) {
      const db = load();
      const devis = db.devis.find((d) => d.id === devisId);
      if (!devis) throw new Error("Devis introuvable");
      if (devis.statut !== "accepte") throw new Error("Seul un devis accepté peut être facturé");
      if (!Array.isArray(lignesValidees) || !lignesValidees.length) {
        throw new Error("Aucune ligne validée : rien à facturer");
      }
      if (db.factures.some((f) => f.devisId === devisId && f.genre !== "avoir" && f.statut !== "annulee")) {
        throw new Error("Une facture existe déjà pour ce devis");
      }
      const client = db.clients.find((c) => c.id === devis.clientId);
      if (!client) throw new Error("Client introuvable");
      const p = db.parametresFacturation;

      const facture = {
        id: uid(), clientId: devis.clientId, devisId, genre: "facture",
        origine: "reel",
        numero: null, statut: "brouillon", dateEmission: null,
        clientSnapshot: { nom: client.displayName, kind: client.kind, adresse: client.billingAddressLine1, codePostal: client.billingPostalCode, ville: client.billingCity },
        vendeurSnapshot: Object.assign({}, p.vendeurSnapshot),
        contenuSnapshot: null,
        conditionsPaiement: p.conditionsPaiement,
        penalitesRetard: p.penalitesRetard,
        indemniteRecouvrement: client.kind === "company" ? 40 : null,
        mentionTva: p.mentionTva,
        totalHT: 0, totalTVA: 0, totalTTC: 0,
        valideLe: null, validePar: null, emiseLe: null, annuleeLe: null,
        createdAt: new Date().toISOString(),
      };
      db.factures.push(facture);
      save(db);

      for (let i = 0; i < lignesValidees.length; i += 1) {
        await this.addFactureLigne(facture.id, lignesValidees[i]);
      }
      const complet = load();
      return delay(complet.factures.find((f) => f.id === facture.id));
    },

    // --- Stock réel (PALIER 4) ---
    // Journal APPEND ONLY : aucun mouvement ne se modifie ni ne se
    // supprime. Une erreur se corrige par un mouvement compensatoire.
    async listEmplacements() {
      const db = load();
      return delay(db.stockEmplacements.filter((e) => !e.archiveLe));
    },
    async createEmplacement(libelle) {
      const db = load();
      const nom = String(libelle || "").trim();
      if (!nom) throw new Error("Le nom de l'emplacement est obligatoire");
      if (db.stockEmplacements.some((e) => !e.archiveLe
          && e.libelle.toLocaleLowerCase("fr") === nom.toLocaleLowerCase("fr"))) {
        throw new Error("Cet emplacement existe déjà");
      }
      const row = { id: uid(), libelle: nom, archiveLe: null };
      db.stockEmplacements.push(row);
      save(db);
      return delay(row);
    },
    async listMouvementsStock(filtre) {
      const db = load();
      let out = db.stockMouvements.slice();
      if (filtre && filtre.interventionId) {
        out = out.filter((m) => m.interventionId === filtre.interventionId);
      }
      if (filtre && filtre.catalogItemId) {
        out = out.filter((m) => m.catalogItemId === filtre.catalogItemId);
      }
      out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return delay(out);
    },
    // Les niveaux sont CALCULÉS depuis le journal, jamais stockés.
    async niveauxStock() {
      const db = load();
      const par = {};
      db.stockMouvements.forEach((m) => {
        const cle = m.catalogItemId + "|" + m.emplacementId;
        if (!par[cle]) {
          par[cle] = { catalogItemId: m.catalogItemId, emplacementId: m.emplacementId, quantite: 0, valeur: 0 };
        }
        par[cle].quantite = arrondir(par[cle].quantite + Number(m.quantite));
        par[cle].valeur = arrondir(par[cle].valeur + Number(m.quantite) * (Number(m.prixUnitaire) || 0));
      });
      return delay(Object.keys(par).map((k) => par[k]));
    },
    async ajouterMouvementStock(mvt) {
      const db = load();
      const type = mvt.type;
      const TYPES = ["entree", "consommation", "retour", "correction", "transfert"];
      if (TYPES.indexOf(type) === -1) throw new Error("Type de mouvement inconnu");

      const quantite = Number(mvt.quantite);
      if (!quantite) throw new Error("La quantité ne peut pas être nulle");
      if (type === "entree" && quantite <= 0) throw new Error("Une entrée doit être positive");
      if (type === "consommation" && quantite >= 0) throw new Error("Une consommation doit être négative");
      if (type === "retour" && quantite <= 0) throw new Error("Un retour doit être positif");
      // Une consommation se rattache TOUJOURS à un chantier : c'est ce qui
      // permettra au palier 5 de facturer depuis le réel.
      if (type === "consommation" && !mvt.interventionId) {
        throw new Error("Une consommation doit être rattachée à un chantier");
      }
      if (!db.catalogItems.some((c) => c.id === mvt.catalogItemId)) {
        throw new Error("Article de catalogue étranger à l'entreprise");
      }
      if (!db.stockEmplacements.some((e) => e.id === mvt.emplacementId && !e.archiveLe)) {
        throw new Error("Emplacement étranger à l'entreprise ou archivé");
      }
      if (mvt.interventionId && !db.interventions.some((i) => i.id === mvt.interventionId)) {
        throw new Error("Chantier étranger à l'entreprise");
      }

      if (mvt.compenseId) {
        const origine = db.stockMouvements.find((m) => m.id === mvt.compenseId);
        if (!origine) throw new Error("Mouvement à compenser introuvable");
        if (origine.compenseId) throw new Error("Un mouvement compensatoire ne se compense pas à son tour");
        if (db.stockMouvements.some((m) => m.compenseId === mvt.compenseId)) {
          throw new Error("Ce mouvement a déjà été compensé");
        }
        if (arrondir(quantite) !== arrondir(-origine.quantite)) {
          throw new Error("La compensation doit annuler exactement le mouvement d'origine (" + (-origine.quantite) + " attendu)");
        }
        if (mvt.catalogItemId !== origine.catalogItemId || mvt.emplacementId !== origine.emplacementId) {
          throw new Error("La compensation doit porter sur le même article et le même emplacement");
        }
      }

      const row = {
        id: uid(), catalogItemId: mvt.catalogItemId, emplacementId: mvt.emplacementId,
        type, quantite,
        prixUnitaire: mvt.prixUnitaire == null ? null : Number(mvt.prixUnitaire),
        interventionId: mvt.interventionId || null,
        motif: String(mvt.motif || "").trim(),
        compenseId: mvt.compenseId || null,
        creePar: mvt.creePar || null,
        createdAt: new Date().toISOString(),
      };
      db.stockMouvements.push(row);
      save(db);
      return delay(row);
    },
    // La seule façon d'annuler : un mouvement inverse qui laisse la trace.
    async annulerMouvementStock(mouvementId, motif, auteurId) {
      const db = load();
      const origine = db.stockMouvements.find((m) => m.id === mouvementId);
      if (!origine) throw new Error("Mouvement à compenser introuvable");
      return this.ajouterMouvementStock({
        catalogItemId: origine.catalogItemId,
        emplacementId: origine.emplacementId,
        type: "correction",
        quantite: -origine.quantite,
        prixUnitaire: origine.prixUnitaire,
        interventionId: origine.interventionId,
        motif: String(motif || "Annulation").trim(),
        compenseId: origine.id,
        creePar: auteurId || null,
      });
    },

    // ⛔ DÉFINITIF. Décision métier de Jonathan : annuler une relance
    // signifie ne plus jamais relancer cette cible.
    async annulerRelance(relanceId) {
      const db = load();
      const r = db.relances.find((x) => x.id === relanceId);
      if (!r) throw new Error("Relance introuvable");
      if (r.statut !== "preparee") {
        throw new Error("Transition de relance interdite : " + r.statut + " vers annulee");
      }
      r.statut = "annulee";
      r.annuleeLe = new Date().toISOString();
      save(db);
      return delay(r);
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
        clientId: data.clientId || null,
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
    // debut est optionnel : il permet la saisie rétroactive, pour le gars
    // qui a oublié de pointer en arrivant sur le chantier.
    async demarrerPointage(interventionId, employeId, debut) {
      const db = load();
      // Cloture un eventuel pointage encore ouvert pour ce gars
      db.pointages.forEach((p) => {
        if (p.employeId === employeId && !p.fin) p.fin = Date.now();
      });
      const quand = debut == null ? Date.now() : new Date(debut).getTime();
      if (isNaN(quand)) throw new Error("Heure de début invalide");
      if (quand > Date.now()) throw new Error("Un pointage ne commence pas dans le futur");
      const p = { id: uid(), interventionId, employeId, debut: quand, fin: null };
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
      await amorcerGestionDemo(this);
      return delay(true);
    },

    // Pas de temps reel en mode demo (tout est local sur l'appareil).
    subscribeChanges() { return { unsubscribe() {} }; },

    // Droits en mode demo : seuls les modules prets sont inclus par defaut.
    // Le reglage local permet toujours de simuler une autre formule.
    modulesActifs() {
      // ⚠️ Cette liste doit suivre le drapeau "pret" de MODULES_CATALOGUE
      // dans app.js. Un module livré et absent d'ici resterait invisible.
      const prets = ["stock", "profitability", "voice", "supplier_invoices", "plombier", "electricien", "peintre"];
      try {
        const brut = localStorage.getItem("chantier_demo_modules");
        return brut == null ? prets : JSON.parse(brut);
      } catch (e) { return prets; }
    },
    facturation() { return { actif: true, jusqu: null, formule: "demo-complete" }; },
    // Métier de l'entreprise : sert à n'afficher que le pack utile.
    metierEntreprise() {
      const db = load();
      return (db.entreprise && db.entreprise.metier) || null;
    },
  };

  window.Chantier = window.Chantier || {};
  window.Chantier.backends = window.Chantier.backends || {};
  window.Chantier.backends.demo = DemoBackend;
  // Par defaut on reste en demo ; app.js choisira le backend au demarrage.
  if (!window.Chantier.api) window.Chantier.api = DemoBackend;
  window.Chantier.util = { uid, todayISO };
})();
