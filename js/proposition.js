/*
 * proposition.js - La brique d'IA partagée de ClicChantier.
 *
 * RÈGLE CENTRALE : cette brique ne fait que PROPOSER. Elle n'écrit jamais
 * rien. C'est l'écran appelant qui, après un clic humain explicite, appelle
 * l'API pour enregistrer. Toute la boucle automatisée passe par ici.
 *
 * Contrat :
 *   Chantier.proposition.proposer(type, contexte)
 *     -> { resume, champs: [...], confiance, question }
 *
 * Chaque champ porte son niveau de confiance : "certain", "probable" ou
 * "a_verifier". Les champs douteux sont remontés EN TÊTE, pour que l'humain
 * regarde d'abord ce qui est fragile.
 *
 * ⛔ La brique n'invente JAMAIS un identifiant. Un article de catalogue
 * qu'elle n'a pas su reconnaître ressort avec catalogItemId = null et une
 * confiance "a_verifier". Un identifiant inventé serait indétectable par
 * l'utilisateur, donc c'est un interdit absolu.
 *
 * Fournisseur : le moteur est derrière un port remplaçable. Le mode
 * "simule" ne fait aucun appel réseau et permet de tout développer et
 * tester à coût zéro. Un moteur distant devra être hébergé dans l'Union
 * européenne : la boucle traite des données personnelles de particuliers
 * français (clients de l'artisan).
 */
(function () {
  "use strict";

  const S = (window.Chantier = window.Chantier || {});

  const CONFIANCE = { CERTAIN: "certain", PROBABLE: "probable", A_VERIFIER: "a_verifier" };
  const RANG = { certain: 2, probable: 1, a_verifier: 0 };

  // Normalise pour comparer : minuscules, sans accents, sans ponctuation.
  function normaliser(texte) {
    return String(texte || "")
      .toLocaleLowerCase("fr")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function motsUtiles(texte) {
    const vides = new Set([
      "le", "la", "les", "un", "une", "des", "du", "de", "et", "a", "au", "aux",
      "pour", "avec", "sur", "dans", "en", "il", "elle", "faut", "faire", "chez",
      "puis", "ensuite", "aussi", "plus", "tres", "sont", "est", "ont", "par",
    ]);
    return normaliser(texte).split(" ").filter((m) => m.length > 2 && !vides.has(m));
  }

  // Score de ressemblance entre un fragment de phrase et un article.
  function score(fragment, item) {
    const mots = motsUtiles(fragment);
    if (!mots.length) return 0;
    const cible = normaliser(item.label + " " + (item.description || "") + " " + (item.reference || ""));
    let touches = 0;
    mots.forEach((m) => { if (cible.indexOf(m) !== -1) touches += 1; });
    return touches / mots.length;
  }

  // Cherche une quantité explicite dans le fragment ("3 robinets", "2h").
  function texteNumerique(texte) {
    return String(texte || "").toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  function quantite(fragment) {
    const m = texteNumerique(fragment).match(/(\d+(?:[.,]\d+)?)\s*(h|heures?|m2|ml|m|u|unites?|pieces?)?/);
    if (!m) return null;
    const valeur = parseFloat(m[1].replace(",", "."));
    return valeur > 0 ? valeur : null;
  }

  /* ------------------------------------------------------------------
   * Moteur simulé : aucun appel réseau.
   * Il découpe la demande en fragments, puis rattache chaque fragment au
   * meilleur article du catalogue. En dessous du seuil, il ne rattache
   * rien plutôt que de se tromper.
   * ---------------------------------------------------------------- */
  const moteurSimule = {
    nom: "simule",
    async lignesDevis(contexte) {
      const catalogue = Array.isArray(contexte.catalogue) ? contexte.catalogue : [];
      const texte = String(contexte.texte || "").trim();
      if (!texte) {
        return { champs: [], question: "Décrivez les travaux à chiffrer." };
      }

      const fragments = texte
        .split(/(?<!\d)\.|\.(?!\d)|[;\n]|,\s*(?:puis|et|ensuite)\s+/i)
        .map((f) => f.trim())
        .filter((f) => f.length > 2);

      const champs = fragments.map((fragment, index) => {
        let meilleur = null;
        let meilleurScore = 0;
        catalogue.forEach((item) => {
          const s = score(fragment, item);
          if (s > meilleurScore) { meilleurScore = s; meilleur = item; }
        });

        const q = quantite(fragment);

        // Seuil délibérément haut : mieux vaut rendre la main que deviner.
        if (!meilleur || meilleurScore < 0.34) {
          return {
            position: index + 1,
            catalogItemId: null,               // ⛔ jamais inventé
            libelle: fragment.slice(0, 300),
            description: "",
            unite: "u",
            quantite: q || 1,
            prixUnitaireHT: 0,
            tauxTVA: 10,
            confiance: CONFIANCE.A_VERIFIER,
            motif: "Aucun article du catalogue ne correspond. À compléter à la main.",
          };
        }

        const sur = meilleurScore >= 0.67;
        return {
          position: index + 1,
          catalogItemId: meilleur.id,
          libelle: meilleur.label,
          description: meilleur.description || "",
          unite: meilleur.unit || "u",
          quantite: q || 1,
          prixUnitaireHT: Number(meilleur.unitPriceExclTax) || 0,
          tauxTVA: Number(meilleur.vatRate) || 10,
          confiance: sur ? CONFIANCE.CERTAIN : CONFIANCE.PROBABLE,
          motif: sur
            ? "Article reconnu dans le catalogue."
            : "Article probable : vérifiez la prestation et la quantité.",
        };
      });

      const question = champs.length
        ? null
        : "Je n'ai pas compris les travaux à chiffrer. Reformulez en une phrase par prestation.";

      return { champs, question };
    },
  };

  /* ------------------------------------------------------------------
   * Rédaction d'une relance (PALIER 3).
   * Le message est une PROPOSITION : il s'affiche, il se corrige à la
   * main, et il ne part que sur un clic humain.
   * ---------------------------------------------------------------- */
  function euros(v) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })
      .format(Number(v) || 0);
  }

  moteurSimule.messageRelance = async function (contexte) {
    const ton = contexte.ton === "direct" ? "direct" : "chaleureux";
    const niveau = contexte.niveau === 2 ? 2 : 1;
    const client = String(contexte.clientNom || "").trim() || "Madame, Monsieur";
    const signature = String(contexte.signature || "").trim();

    let corps;
    if (contexte.cible === "devis") {
      const objet = String(contexte.objet || "").trim();
      const intro = niveau === 1
        ? (ton === "chaleureux"
            ? "Je reviens vers vous au sujet du devis « " + objet + " » que je vous ai adressé."
            : "Je vous contacte au sujet du devis « " + objet + " ».")
        : (ton === "chaleureux"
            ? "Je me permets de revenir une dernière fois vers vous concernant le devis « " + objet + " »."
            : "Sans retour de votre part, je reviens vers vous concernant le devis « " + objet + " ».");
      const relance = niveau === 1
        ? "Souhaitez-vous que nous avancions ? Je reste à votre disposition pour l'ajuster si besoin."
        : "Si le projet n'est plus d'actualité, dites-le-moi simplement, je clôturerai le dossier.";
      corps = intro + " Il s'élève à " + euros(contexte.montant) + " TTC. " + relance;
    } else {
      const numero = String(contexte.numero || "").trim();
      const intro = niveau === 1
        ? (ton === "chaleureux"
            ? "Sauf erreur de ma part, la facture " + numero + " reste à régler."
            : "La facture " + numero + " n'a pas été réglée à ce jour.")
        : (ton === "chaleureux"
            ? "Malgré ma précédente relance, la facture " + numero + " reste impayée."
            : "Deuxième relance concernant la facture " + numero + ", toujours impayée.");
      const suite = niveau === 1
        ? "Il reste " + euros(contexte.reste) + " à régler. Si le règlement a déjà été fait, merci de ne pas tenir compte de ce message."
        : "Le solde de " + euros(contexte.reste) + " reste dû. Merci de me tenir informé du règlement sous quinzaine.";
      corps = intro + " " + suite;
    }

    const champs = [{
      position: 1,
      cle: "message",
      libelle: "Message de relance",
      valeur: "Bonjour " + client + ",\n\n" + corps
        + (signature ? "\n\nCordialement,\n" + signature : "\n\nCordialement,"),
      confiance: CONFIANCE.PROBABLE,
      motif: "Message rédigé automatiquement. Relisez-le avant de l'envoyer.",
    }];

    // Sans nom de client, on ne devine pas : on le signale.
    if (!String(contexte.clientNom || "").trim()) {
      champs[0].confiance = CONFIANCE.A_VERIFIER;
      champs[0].motif = "Le nom du client est inconnu : la formule d'appel est générique.";
    }
    return { champs, question: null };
  };

  /* ------------------------------------------------------------------
   * Compte rendu d'intervention (PALIER 6).
   * L'artisan raconte sa journée, l'application en tire des données
   * STRUCTURÉES qu'il valide champ par champ. Elle ne se contente pas de
   * ranger du texte : ce qu'elle extrait alimente le stock et la facture.
   * ---------------------------------------------------------------- */
  moteurSimule.compteRendu = async function (contexte) {
    const texte = String(contexte.texte || "").trim();
    const catalogue = Array.isArray(contexte.catalogue) ? contexte.catalogue : [];
    if (!texte) {
      return { champs: [], question: "Racontez ce que vous avez fait sur le chantier." };
    }

    const champs = [];
    const norm = normaliser(texte);

    // 1) Le récit lui-même, toujours conservé tel quel.
    champs.push({
      position: 1, cle: "recit", libelle: "Travaux réalisés",
      valeur: texte, confiance: CONFIANCE.CERTAIN,
      motif: "Vos mots, conservés tels quels.",
    });

    // 2) La durée annoncée. « 4 heures », « 4h », « 4 h 30 ».
    const mDuree = texteNumerique(texte).match(/(\d+(?:[.,]\d+)?)\s*(?:h|heures?)\b/);
    if (mDuree) {
      champs.push({
        position: 2, cle: "heures", libelle: "Durée annoncée",
        valeur: parseFloat(mDuree[1].replace(",", ".")),
        confiance: CONFIANCE.PROBABLE,
        motif: "Durée entendue dans votre récit. Elle ne remplace pas votre pointage.",
      });
    }

    // 3) Les matériaux reconnus, avec leur quantité.
    // ⛔ Un matériau non reconnu n'est PAS inventé : il ressort sans
    // identifiant et exige un choix manuel.
    // Même découpage que pour le devis : on coupe sur les fins de phrase,
    // pas sur les virgules. « Pose d'une robinetterie, 3 unités » doit
    // rester d'un bloc, sinon la quantité se perd.
    const phrases = texte
      .split(/(?<!\d)\.|\.(?!\d)|[;\n]|,\s*(?:puis|et|ensuite)\s+/i)
      .map((p) => p.trim())
      .filter((p) => p.length > 2);
    let position = 3;
    phrases.forEach((phrase) => {
      let meilleur = null;
      let meilleurScore = 0;
      catalogue.forEach((item) => {
        const s = score(phrase, item);
        if (s > meilleurScore) { meilleurScore = s; meilleur = item; }
      });
      if (!meilleur || meilleurScore < 0.34) return;
      const q = quantite(phrase);
      champs.push({
        position: position += 1, cle: "materiau", libelle: "Matériau posé",
        catalogItemId: meilleur.id,
        valeur: meilleur.label,
        quantite: q || 1,
        confiance: meilleurScore >= 0.67 ? CONFIANCE.PROBABLE : CONFIANCE.A_VERIFIER,
        motif: q
          ? "Quantité entendue dans votre récit. Vérifiez-la avant de valider."
          : "Quantité non entendue : 1 par défaut, à corriger.",
      });
    });

    // 4) ⭐ L'alerte d'oubli : un retour annoncé sans devis, c'est du
    // travail qui part à la poubelle si personne ne le note.
    if (/\b(revenir|repasser|retour|finir plus tard|deuxieme passage|autre jour)\b/.test(norm)) {
      champs.push({
        position: position += 1, cle: "retour_prevu", libelle: "Retour à prévoir",
        valeur: true, confiance: CONFIANCE.A_VERIFIER,
        motif: "Vous parlez de revenir sur place. Pensez à le chiffrer : sans devis, ce passage ne sera pas facturé.",
      });
    }

    return { champs, question: null };
  };

  /* ------------------------------------------------------------------
   * Le port. Un moteur distant s'enregistre ici, sans toucher aux écrans.
   * ---------------------------------------------------------------- */
  let moteur = moteurSimule;

  const proposition = {
    CONFIANCE,

    /** Remplace le moteur. Le moteur distant DOIT être hébergé dans l'UE. */
    utiliserMoteur(nouveau) {
      moteur = nouveau && typeof nouveau.lignesDevis === "function" ? nouveau : moteurSimule;
    },

    moteurCourant() { return moteur.nom || "inconnu"; },

    /**
     * Produit une proposition. N'ÉCRIT RIEN.
     * @returns {Promise<{resume, champs, confiance, question, moteur}>}
     */
    async proposer(type, contexte) {
      let brut;
      if (type === "devis_lignes") {
        brut = await moteur.lignesDevis(contexte || {});
      } else if (type === "relance_message") {
        if (typeof moteur.messageRelance !== "function") {
          throw new Error("Le moteur ne sait pas rédiger de relance");
        }
        brut = await moteur.messageRelance(contexte || {});
      } else if (type === "compte_rendu") {
        if (typeof moteur.compteRendu !== "function") {
          throw new Error("Le moteur ne sait pas structurer un compte rendu");
        }
        brut = await moteur.compteRendu(contexte || {});
      } else {
        throw new Error("Type de proposition inconnu : " + type);
      }
      const champs = Array.isArray(brut.champs) ? brut.champs.slice() : [];

      // Les champs fragiles remontent en tête : l'humain regarde d'abord
      // ce qui risque d'être faux. L'ordre d'origine départage le reste.
      champs.sort((a, b) => {
        const d = RANG[a.confiance] - RANG[b.confiance];
        return d !== 0 ? d : a.position - b.position;
      });

      // La confiance globale est celle du maillon le plus faible.
      let globale = CONFIANCE.CERTAIN;
      champs.forEach((c) => {
        if (RANG[c.confiance] < RANG[globale]) globale = c.confiance;
      });
      if (!champs.length) globale = CONFIANCE.A_VERIFIER;

      const aVerifier = champs.filter((c) => c.confiance === CONFIANCE.A_VERIFIER).length;
      let resume;
      if (type === "compte_rendu") {
        const mats = champs.filter((c) => c.cle === "materiau").length;
        resume = champs.length
          ? "Compte rendu structuré" + (mats ? ", " + mats + " matériau" + (mats > 1 ? "x" : "") + " repéré" + (mats > 1 ? "s" : "") : "")
            + (aVerifier ? ", " + aVerifier + " point" + (aVerifier > 1 ? "s" : "") + " à vérifier" : "")
          : "Rien de structuré";
      } else if (type === "relance_message") {
        resume = champs.length
          ? "Message de relance proposé" + (aVerifier ? ", à vérifier avant envoi" : ", à relire avant envoi")
          : "Aucun message proposé";
      } else {
        resume = champs.length
          ? champs.length + " ligne" + (champs.length > 1 ? "s" : "") + " proposée" +
            (champs.length > 1 ? "s" : "") +
            (aVerifier ? ", dont " + aVerifier + " à vérifier" : "")
          : "Aucune ligne proposée";
      }

      return {
        resume,
        champs,
        confiance: globale,
        question: brut.question || null,
        moteur: moteur.nom || "inconnu",
      };
    },
  };

  S.proposition = proposition;
})();
