/*
 * acces.js - Porte d'entree temporaire, le temps des essais en conditions
 * reelles.
 *
 * ClicChantier est en ligne pour que Jonathan puisse l'essayer depuis
 * n'importe quel poste, mais le produit n'est PAS ouvert au public : l'audit
 * du 2026-08-20 a conclu NO-GO, et l'isolation des donnees entre entreprises
 * n'est pas encore prouvee.
 *
 * ⚠️ Ce verrou est une porte, pas un coffre-fort. Le code s'execute dans le
 * navigateur : quelqu'un qui sait lire du JavaScript peut le contourner. Il
 * arrete les visiteurs, pas un developpeur determine. Le vrai verrou reste le
 * compte Supabase et la RLS.
 * C'est pour cela que le code n'est PAS ecrit en clair ici : seule son
 * empreinte SHA-256 figure dans le depot public.
 *
 * ⛔ A RETIRER le jour de l'ouverture : supprimer ce fichier, sa ligne dans
 * index.html et son entree dans sw.js.
 */
(function () {
  "use strict";

  var EMPREINTE = "5fd047e0333c825c6431a749365d59075e9d0209190ad85248cb2b8b18529550";
  var CLE = "chantier_acces_v1";

  // Les essais locaux ne sont pas genes : le verrou ne sert que sur le web.
  var hote = location.hostname;
  if (hote === "localhost" || hote === "127.0.0.1" || hote === "" || hote === "::1") return;

  // Deja entre sur cet appareil : on ne redemande rien.
  try {
    if (localStorage.getItem(CLE) === EMPREINTE) return;
  } catch (e) {
    /* stockage indisponible : on redemandera a chaque visite, tant pis */
  }

  // WebCrypto exige HTTPS. Sans lui, on ferme plutot que d'ouvrir en grand.
  var sousCrypto = window.crypto && window.crypto.subtle;

  function empreinte(texte) {
    var octets = new TextEncoder().encode(texte);
    return sousCrypto.digest("SHA-256", octets).then(function (tampon) {
      return Array.prototype.map
        .call(new Uint8Array(tampon), function (o) { return ("0" + o.toString(16)).slice(-2); })
        .join("");
    });
  }

  function poser() {
    var voile = document.createElement("div");
    voile.setAttribute("id", "acces-voile");
    voile.innerHTML =
      '<div class="acces-carte">' +
        '<h1>ClicChantier</h1>' +
        '<p class="acces-note">Application en cours de finalisation. ' +
        "L'accès est réservé aux essais pour le moment.</p>" +
        '<label class="acces-champ">Code d\'accès' +
          '<input type="password" id="acces-code" autocomplete="off" ' +
          'autocapitalize="characters" spellcheck="false" inputmode="text">' +
        "</label>" +
        '<p class="acces-erreur" id="acces-erreur" hidden>Code incorrect.</p>' +
        '<button type="button" id="acces-valider">Entrer</button>' +
        '<p class="acces-pied">Vous cherchez ClicChantier&nbsp;? ' +
        '<a href="https://generationapp.fr/applications/clicchantier/">Suivre son ouverture</a></p>' +
      "</div>";
    document.documentElement.appendChild(voile);
    document.documentElement.style.overflow = "hidden";

    var champ = voile.querySelector("#acces-code");
    var erreur = voile.querySelector("#acces-erreur");
    var bouton = voile.querySelector("#acces-valider");

    function refuser() {
      erreur.hidden = false;
      champ.value = "";
      champ.focus();
    }

    function verifier() {
      var saisi = (champ.value || "").trim();
      if (!saisi) return refuser();
      if (!sousCrypto) return refuser();
      empreinte(saisi).then(function (h) {
        if (h !== EMPREINTE) return refuser();
        try { localStorage.setItem(CLE, EMPREINTE); } catch (e) {}
        voile.remove();
        document.documentElement.style.overflow = "";
      }).catch(refuser);
    }

    bouton.addEventListener("click", verifier);
    champ.addEventListener("keydown", function (e) {
      if (e.key === "Enter") verifier();
    });
    setTimeout(function () { champ.focus(); }, 60);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", poser);
  } else {
    poser();
  }
})();
