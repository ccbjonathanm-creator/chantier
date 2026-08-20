const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function stockage(initial) {
  const donnees = new Map(Object.entries(initial || {}));
  return {
    donnees,
    getItem(cle) { return donnees.has(cle) ? donnees.get(cle) : null; },
    setItem(cle, valeur) { donnees.set(cle, String(valeur)); },
    removeItem(cle) { donnees.delete(cle); },
  };
}

function fauxIndexedDB() {
  const lignes = new Map();
  let creee = false;
  const base = {
    objectStoreNames: { contains() { return creee; } },
    createObjectStore() { creee = true; },
    close() {},
    transaction() {
      const tx = {
        objectStore() {
          return {
            put(row) { lignes.set(row.id, row); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); },
            delete(id) { lignes.delete(id); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); },
            get(id) {
              const requete = {};
              setTimeout(() => {
                requete.result = lignes.get(id);
                if (requete.onsuccess) requete.onsuccess();
              }, 0);
              return requete;
            },
          };
        },
      };
      return tx;
    },
  };
  return {
    lignes,
    open() {
      const requete = { result: base };
      setTimeout(() => {
        if (!creee && requete.onupgradeneeded) requete.onupgradeneeded();
        if (requete.onsuccess) requete.onsuccess();
      }, 0);
      return requete;
    },
  };
}

function chargerDemo(localStorage, indexedDB, urls) {
  const contexte = {
    window: { Chantier: {}, alert() {}, console }, localStorage, indexedDB,
    URL: { createObjectURL(blob) { urls.push(blob); return "blob:test-" + urls.length; }, revokeObjectURL() {} },
    setTimeout, clearTimeout, console, Date, Promise, Math, Intl,
  };
  vm.createContext(contexte);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "api.js"), "utf8"), contexte);
  return contexte.window.Chantier.backends.demo;
}

test("les paramètres de facturation et de rentabilité sont persistants", async () => {
  const localStorage = stockage();
  const api = chargerDemo(localStorage, fauxIndexedDB(), []);
  await api.saveParametresFacturation({
    vendeurSnapshot: { nom: "Atelier Test", siret: "12345678900012", adresse: "1 rue Test", codePostal: "71200", ville: "Le Creusot" },
    conditionsPaiement: "Paiement à réception.", penalitesRetard: "Pénalités légales.",
    mentionTva: "TVA sur les encaissements.", tauxHoraireVente: 62.5,
    coutHoraireInterne: 31.25, tvaMainOeuvre: 20,
  });
  const relu = await api.getParametresFacturation();
  assert.equal(relu.vendeurSnapshot.siret, "12345678900012");
  assert.equal(relu.tauxHoraireVente, 62.5);
  assert.equal(relu.coutHoraireInterne, 31.25);
  assert.equal(relu.tvaMainOeuvre, 20);
  await assert.rejects(() => api.saveParametresFacturation({ tauxHoraireVente: -1, coutHoraireInterne: 1, tvaMainOeuvre: 10 }), /positifs ou nuls/);
});

test("le justificatif local conserve son contenu binaire après rechargement du backend", async () => {
  const localStorage = stockage();
  const indexedDB = fauxIndexedDB();
  const urls = [];
  const octets = Uint8Array.from([37, 80, 68, 70, 45, 49, 46, 52]);
  const contenu = { async arrayBuffer() { return octets.buffer; }, octets };
  const api = chargerDemo(localStorage, indexedDB, urls);
  const document = await api.importerFactureFournisseur({
    nom: "preuve.pdf", typeMime: "application/pdf", tailleOctets: octets.length, contenu,
  });

  const apresRechargement = chargerDemo(localStorage, indexedDB, urls);
  const original = await apresRechargement.getJustificatifFournisseur(document.id);
  assert.equal(original.nom, "preuve.pdf");
  assert.equal(original.url, "blob:test-1");
  assert.equal(urls[0], contenu, "le blob stocké est bien celui qui a été importé");
  assert.ok(indexedDB.lignes.get(document.id).blob, "les octets vivent dans le stockage binaire, pas seulement dans les métadonnées");
});

test("un import sans contenu ne crée aucune fausse pièce jointe", async () => {
  const localStorage = stockage();
  const indexedDB = fauxIndexedDB();
  const api = chargerDemo(localStorage, indexedDB, []);
  await assert.rejects(() => api.importerFactureFournisseur({
    nom: "vide.pdf", typeMime: "application/pdf", tailleOctets: 8,
  }), /contenu du fichier est manquant/);
  assert.equal((await api.listFacturesFournisseurs()).length, 0);
  assert.equal(indexedDB.lignes.size, 0);
});

test("l'écran Réglages expose toutes les données nécessaires", () => {
  const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  ["f-vendeur-nom", "f-vendeur-siret", "f-vendeur-adresse", "f-vendeur-cp", "f-vendeur-ville",
    "f-conditions", "f-penalites", "f-mention-tva", "f-taux-vente", "f-cout-interne", "f-tva-mo"]
    .forEach((id) => assert.match(app, new RegExp(id)));
  assert.match(app, /await api\.saveParametresFacturation/);
  assert.match(app, /Main d’œuvre au taux de l’entreprise/);
});

test("le backend cloud expose la même interface pour Stock, Rentabilité et fournisseurs", () => {
  const cloud = fs.readFileSync(path.join(root, "js", "backend-supabase.js"), "utf8");
  ["listEmplacements", "createEmplacement", "listMouvementsStock", "niveauxStock",
    "ajouterMouvementStock", "annulerMouvementStock", "rattacherChantierAuDevis",
    "reelDuChantier", "proposerFactureReelle", "creerFactureDepuisReel",
    "importerFactureFournisseur", "listFacturesFournisseurs", "getFactureFournisseur",
    "getJustificatifFournisseur", "enregistrerExtraction", "validerFactureFournisseur",
    "rejeterFactureFournisseur"]
    .forEach((nom) => assert.match(cloud, new RegExp("async " + nom + "\\("), nom));
  assert.match(cloud, /storage\.from\("clicchantier-justificatifs"\)/);
  assert.match(cloud, /rpc\("valider_facture_fournisseur"/);
});

test("le module transmet le vrai fichier et permet de rouvrir l'original", () => {
  const module = fs.readFileSync(path.join(root, "js", "modules-gestion.js"), "utf8");
  assert.match(module, /contenu: fichier/);
  assert.match(module, /Ouvrir le justificatif original/);
  assert.match(module, /api\.getJustificatifFournisseur/);
  assert.match(module, /espace privé de votre entreprise/);
});

