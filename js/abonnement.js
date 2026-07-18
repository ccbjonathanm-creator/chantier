/*
 * abonnement.js - Ecran d'abonnement + verrou d'acces (mode Cloud).
 *
 * Depend de window.Chantier.api (backend cloud) qui expose :
 *   facturation() -> { statut, formule, essaiFin, periodeFin, ouvert, aClientStripe, ... }
 *   creerCheckout(formule) -> URL Stripe Checkout
 *   ouvrirPortail()        -> URL portail de facturation Stripe
 *
 * Regle d'acces (identique au serveur app.abonnement_ouvert) :
 *   - statut 'actif'  => ouvert
 *   - statut 'essai'  => ouvert tant que essai_fin >= aujourd'hui
 *   - 'suspendu' / 'resilie' / essai expire => FERME (l'app se bloque)
 *
 * Le serveur reste la source de verite (RLS RESTRICTIVE) : ce verrou est le
 * confort d'usage cote appli. Meme si on le contournait, la base refuse les
 * ecritures quand l'abonnement est ferme.
 */
(function () {
  "use strict";

  // Catalogue d'AFFICHAGE. Les prix/plafonds refletent public.formules
  // (source de verite en base). Affiches TTC (franchise de TVA).
  var CATALOGUE = [
    { code: "essentiel", libelle: "Essentiel", prix: "19,90 € / mois", users: 5,  desc: "Jusqu'a 5 utilisateurs. Planning, pointage, chantiers, suivi vocal." },
    { code: "equipe",    libelle: "Equipe",    prix: "39,90 € / mois", users: 15, desc: "Jusqu'a 15 utilisateurs. Ideal pour une equipe qui grandit." },
    { code: "pro",       libelle: "Pro",       prix: "69,90 € / mois", users: 30, desc: "Jusqu'a 30 utilisateurs. Pour les entreprises structurees." },
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // Renvoie true si l'app doit etre utilisable pour cette facturation.
  function ouvert(fact) {
    if (!fact) return true; // pas de ligne de facturation : on n'enferme pas
    return !!fact.ouvert;
  }

  // Jours restants d'essai (ou null). essaiFin est un timestamp (heure de fin
  // reelle) : on arrondit au jour superieur (une fraction de jour = 1 jour).
  function joursEssai(fact) {
    if (!fact || fact.statut !== "trialing" || !fact.essaiFin) return null;
    var b = new Date(fact.essaiFin).getTime();
    if (isNaN(b)) return null;
    return Math.ceil((b - Date.now()) / 86400000);
  }
  function fmtDateCourt(iso) {
    try { return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }); }
    catch (e) { return String(iso || ""); }
  }

  // Bandeau d'info d'essai, avec avertissements renforces a J-7, J-3 et J-1.
  function banniere(fact) {
    if (!fact || fact.statut !== "trialing") return "";
    var j = joursEssai(fact);
    if (j == null || j <= 0) return ""; // expire => gere par le verrou plein ecran
    var jour = j + " jour" + (j > 1 ? "s" : "");
    var urgent = j <= 3 ? " abo-urgent" : "";
    var txt;
    if (j === 1) txt = "Dernier jour d'essai. Choisissez une formule pour ne pas perdre l'acces demain.";
    else if (j <= 3) txt = "Plus que " + jour + " d'essai. Pensez a choisir votre abonnement.";
    else if (j <= 7) txt = "Il reste " + jour + " d'essai.";
    else txt = "Periode d'essai : " + jour + " restant" + (j > 1 ? "s" : "") + ".";
    return '<div class="abo-banniere' + urgent + '">' + esc(txt) + " </div>";
  }

  // Lance le Checkout Stripe pour une formule (redirige la page).
  function lancerCheckout(code, btn, msgEl) {
    var api = window.Chantier.api;
    if (!api || !api.creerCheckout) { if (msgEl) msgEl.textContent = "Paiement indisponible en mode demonstration."; return; }
    if (btn) { btn.disabled = true; btn.textContent = "Redirection..."; }
    if (msgEl) msgEl.textContent = "";
    api.creerCheckout(code).then(function (url) {
      window.location.href = url;
    }).catch(function (e) {
      if (btn) { btn.disabled = false; btn.textContent = "Choisir"; }
      if (msgEl) msgEl.textContent = "Erreur : " + (e && e.message ? e.message : e);
    });
  }

  // Ouvre le portail Stripe (gerer / annuler).
  function ouvrirPortail(btn, msgEl) {
    var api = window.Chantier.api;
    if (!api || !api.ouvrirPortail) return;
    if (btn) { btn.disabled = true; btn.textContent = "Ouverture..."; }
    if (msgEl) msgEl.textContent = "";
    api.ouvrirPortail().then(function (url) {
      window.location.href = url;
    }).catch(function (e) {
      if (btn) { btn.disabled = false; btn.textContent = "Gerer / annuler mon abonnement"; }
      if (msgEl) msgEl.textContent = "Erreur : " + (e && e.message ? e.message : e);
    });
  }

  // Cartes de choix de formule (patron). withActuelle = surligne la formule en cours.
  function cartesFormules(fact) {
    var actuelle = fact && fact.formule;
    return CATALOGUE.map(function (f) {
      var on = actuelle === f.code;
      return (
        '<div class="abo-carte' + (on ? " on" : "") + '">' +
          '<div class="abo-carte-tete"><span class="abo-nom">' + esc(f.libelle) + '</span>' +
            (on ? '<span class="abo-tag">Formule actuelle</span>' : "") + "</div>" +
          '<div class="abo-prix">' + esc(f.prix) + "</div>" +
          '<div class="abo-desc">' + esc(f.desc) + "</div>" +
          '<button class="abo-choisir" data-code="' + f.code + '">' + (on ? "Reprendre" : "Choisir") + "</button>" +
        "</div>"
      );
    }).join("");
  }

  // Ecran PLEIN qui bloque l'app quand l'abonnement est ferme.
  // role : 'patron' | 'employe'. Renvoie un element DOM a injecter dans #app.
  function ecranBloque(role, fact) {
    var eff = (fact && (fact.statutEffectif || fact.statut)) || "";
    var titre, sous;
    if (eff === "trial_expired") { titre = "Votre periode d'essai est terminee"; sous = "Choisissez une formule pour continuer a utiliser ClicChantier. Vos donnees sont conservees."; }
    else if (eff === "canceled") { titre = "Abonnement resilie"; sous = "Reactivez un abonnement pour retrouver l'acces. Vos donnees sont conservees."; }
    else if (eff === "unpaid") { titre = "Abonnement impaye"; sous = "Apres plusieurs tentatives, le paiement n'a pas abouti. Regularisez pour reactiver l'acces."; }
    else { titre = "Paiement en echec"; sous = "Un paiement n'a pas abouti. Mettez a jour votre moyen de paiement pour reactiver l'acces."; }

    if (role !== "patron") {
      return el(
        '<div class="abo-gate">' +
          '<div class="abo-gate-box">' +
            '<h1>' + esc(titre) + "</h1>" +
            '<p>L\'abonnement de votre entreprise n\'est plus actif. Prevenez votre responsable (patron du compte) pour le reactiver.</p>' +
          "</div>" +
        "</div>"
      );
    }

    var box = el(
      '<div class="abo-gate">' +
        '<div class="abo-gate-box">' +
          '<h1>' + esc(titre) + "</h1>" +
          '<p>' + esc(sous) + "</p>" +
          '<div class="abo-cartes">' + cartesFormules(fact) + "</div>" +
          (fact && fact.aClientStripe ? '<button class="abo-portail" id="abo-portail">Gerer / annuler mon abonnement</button>' : "") +
          '<p class="abo-msg" id="abo-msg"></p>' +
          '<button class="abo-sortie" id="abo-signout">Se deconnecter</button>' +
        "</div>" +
      "</div>"
    );
    var msgEl = box.querySelector("#abo-msg");
    box.querySelectorAll(".abo-choisir").forEach(function (b) {
      b.addEventListener("click", function () { lancerCheckout(b.dataset.code, b, msgEl); });
    });
    var portail = box.querySelector("#abo-portail");
    if (portail) portail.addEventListener("click", function () { ouvrirPortail(portail, msgEl); });
    var out = box.querySelector("#abo-signout");
    if (out) out.addEventListener("click", function () {
      try { window.Chantier.api.setSession(null); } catch (e) {}
      location.reload();
    });
    return box;
  }

  // Bloc "Abonnement" affiche dans les reglages du patron (cloud).
  // Renvoie du HTML, a placer dans un conteneur. Les handlers sont branches
  // ensuite par brancherReglages().
  function htmlReglages(fact) {
    var eff = fact && (fact.statutEffectif || fact.statut);
    var etat, detail = "";
    if (!fact) { etat = "Non geree"; }
    else if (eff === "active") {
      etat = '<span class="mod-badge ok">Actif</span>';
      var f = CATALOGUE.filter(function (x) { return x.code === fact.formule; })[0];
      detail = (f ? "Formule " + esc(f.libelle) + ". " : "") + (fact.periodeFin ? "Prochaine echeance : " + esc(fact.periodeFin) + "." : "");
    } else if (eff === "trialing") {
      var j = joursEssai(fact);
      etat = '<span class="mod-badge ok">Essai</span>';
      detail = (j != null && j > 0) ? (j + " jour" + (j > 1 ? "s" : "") + " restant" + (j > 1 ? "s" : "") + ".") : "";
    } else if (eff === "trial_expired") {
      etat = '<span class="mod-badge lock">Essai termine</span>'; detail = "Choisissez une formule pour reactiver l'acces.";
    } else if (eff === "past_due") {
      etat = '<span class="mod-badge lock">Paiement en retard</span>'; detail = "Un paiement n'a pas abouti.";
    } else if (eff === "unpaid") {
      etat = '<span class="mod-badge lock">Impaye</span>'; detail = "Regularisez pour reactiver l'acces.";
    } else if (eff === "canceled") {
      var enGrace = fact.periodeFin && new Date(fact.periodeFin).getTime() >= Date.now();
      etat = '<span class="mod-badge ' + (enGrace ? "ok" : "lock") + '">Resilie</span>';
      detail = enGrace ? ("Acces conserve jusqu'au " + esc(fmtDateCourt(fact.periodeFin)) + ".") : "Reactivez un abonnement pour retrouver l'acces.";
    } else { etat = esc(eff || ""); }

    var actions = "";
    if (fact && eff !== "active") {
      actions = '<div class="abo-cartes reg">' + cartesFormules(fact) + "</div>";
    }
    if (fact && fact.aClientStripe) {
      actions += '<button class="abo-portail" id="abo-portail-reg">Gerer / annuler mon abonnement</button>';
    }

    return (
      '<div class="reg-titre">Abonnement</div>' +
      '<p class="reg-txt">Statut : ' + etat + (detail ? ' <span class="mod-desc">' + detail + "</span>" : "") + "</p>" +
      actions +
      '<p class="abo-msg" id="abo-msg-reg"></p>'
    );
  }

  function brancherReglages(container) {
    if (!container) return;
    var msgEl = container.querySelector("#abo-msg-reg");
    container.querySelectorAll(".abo-choisir").forEach(function (b) {
      b.addEventListener("click", function () { lancerCheckout(b.dataset.code, b, msgEl); });
    });
    var portail = container.querySelector("#abo-portail-reg");
    if (portail) portail.addEventListener("click", function () { ouvrirPortail(portail, msgEl); });
  }

  window.Chantier = window.Chantier || {};
  window.Chantier.abonnement = {
    CATALOGUE: CATALOGUE,
    ouvert: ouvert,
    banniere: banniere,
    ecranBloque: ecranBloque,
    htmlReglages: htmlReglages,
    brancherReglages: brancherReglages,
  };
})();
