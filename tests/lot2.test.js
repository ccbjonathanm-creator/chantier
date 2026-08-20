const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function chargerDocuments() {
  const contexte = { window: { Chantier: {} }, Intl, Date, console };
  vm.createContext(contexte);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "documents.js"), "utf8"), contexte);
  return contexte.window.Chantier.documents;
}

test("le document commercial contient toutes les mentions demandées", () => {
  const docs = chargerDocuments();
  const html = docs.documentHTML({
    titre: "Facture", numero: "F2026-0042", date: "2026-08-20",
    vendeur: { nom: "Plomberie Martin", siret: "123 456 789 00012", adresse: "1 rue du Test", codePostal: "71200", ville: "Le Creusot" },
    client: { nom: "Atelier Dupont", kind: "company", adresse: "2 rue Client", codePostal: "71000", ville: "Mâcon" },
    lignes: [{ libelle: "Main d’œuvre", unite: "h", quantite: 2, prixUnitaireHT: 50, tauxTVA: 10 }],
    totalHT: 100, totalTVA: 10, totalTTC: 110,
    conditionsPaiement: "Paiement à 30 jours.", penalitesRetard: "Trois fois le taux légal.",
    indemniteRecouvrement: 40, mentionTva: "TVA sur les encaissements.",
  });

  ["Plomberie Martin", "SIRET", "Atelier Dupont", "F2026-0042", "20/08/2026",
    "Main d’œuvre", "Total HT", "TVA", "Total TTC", "Conditions de paiement",
    "Pénalités de retard", "Indemnité de recouvrement", "40,00", "TVA sur les encaissements"]
    .forEach((attendu) => assert.match(html, new RegExp(attendu.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
});

test("un document incomplet prévient explicitement avant impression", () => {
  const docs = chargerDocuments();
  const html = docs.documentHTML({ titre: "Devis", numero: "D2026-TEST", client: {}, vendeur: {}, lignes: [] });
  assert.match(html, /Document incomplet/);
  assert.match(html, /nom du vendeur/);
  assert.match(html, /SIRET/);
  assert.match(html, /identité du client/);
});

test("l'action d'aperçu appelle l'impression du navigateur sans bibliothèque PDF", () => {
  const source = fs.readFileSync(path.join(root, "js", "documents.js"), "utf8");
  assert.match(source, /Imprimer \/ Enregistrer en PDF/);
  assert.match(source, /window\.print\(\)/);
  assert.doesNotMatch(source, /jspdf|pdfmake|html2canvas/i);
});

test("la référence de devis est stable et le mailto encode destinataire, objet et corps", () => {
  const docs = chargerDocuments();
  assert.equal(docs.referenceDevis({ id: "devis_abc-12345678", createdAt: "2026-08-20T08:00:00Z" }), "D2026-12345678");
  const lien = docs.composerMailto("client@example.fr", "Relance devis D2026-1", "Bonjour\nVotre devis reste valable.");
  assert.match(lien, /^mailto:client%40example\.fr\?/);
  assert.ok(lien.includes("subject=" + encodeURIComponent("Relance devis D2026-1")));
  assert.ok(lien.includes("body=" + encodeURIComponent("Bonjour\nVotre devis reste valable.")));
  assert.throws(() => docs.composerMailto("adresse-invalide", "x", "y"), /adresse e-mail valide/);
});

test("les actions de relance disent la vérité et la confirmation est séparée", () => {
  const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  assert.match(app, /Ouvrir dans ma messagerie/);
  assert.match(app, /J'ai envoyé ce message/);
  assert.match(app, /ClicChantier n'envoie aucun message automatiquement/);
  assert.match(app, /documents\.composerMailto/);
  assert.match(app, /api\.marquerRelanceEnvoyee/);
  assert.doesNotMatch(app, /Valider et envoyer/);
});

test("le module vocal réutilise la dictée et Groq avec un repli local annoncé", () => {
  const module = fs.readFileSync(path.join(root, "js", "modules-gestion.js"), "utf8");
  assert.match(module, /ia\.creerDicteur/);
  assert.match(module, /await ia\.reformuler/);
  assert.match(module, /Micro indisponible dans ce navigateur/);
  assert.match(module, /Aucune clé Groq/);
  assert.match(module, /Structurer localement/);
  assert.match(module, /la structuration locale reste disponible/);
});

test("la PWA charge atomiquement les nouveaux fichiers du lot 2", () => {
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  // La version n'est PAS figée ici : on vérifie qu'elle est la même partout.
  // Figer « v=37 » cassait ce test à chaque montée de version, ce qui poussait
  // à ne plus monter la version, donc à laisser les navigateurs sur l'ancienne
  // application. Le vrai défaut à attraper est un fichier resté en arrière.
  const version = (sw.match(/chantier-v(\d+)/) || [])[1];
  assert.ok(version, "sw.js doit porter une version chantier-vN");
  // Comparaison de texte simple : une expression régulière construite à la
  // volée exige d'échapper les points et les barres, et se trompe en silence.
  for (const fichier of ["js/documents.js", "js/modules-gestion.js", "js/acces.js"]) {
    const attendu = fichier + "?v=" + version;
    assert.ok(index.includes(attendu), fichier + " doit être versionné v=" + version + " dans index.html");
    assert.ok(sw.includes(attendu), fichier + " doit être versionné v=" + version + " dans sw.js");
  }
  // Aucun fichier ne doit rester sur une version antérieure.
  const retardataires = (index.match(/\?v=(\d+)/g) || []).filter((v) => v !== "?v=" + version);
  assert.deepEqual(retardataires, [], "des fichiers d'index.html sont restés sur une ancienne version");
});
