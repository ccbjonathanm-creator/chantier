// Verrouille l'enchainement des etapes, signale par Jonathan le 2026-08-25 :
// « on crée le client, on devrait avoir directement un bouton créer le devis,
// et une fois le devis validé un bouton pour programmer l'intervention avec
// les infos du client déjà remplies ».
//
// Le defaut de fond n'etait pas l'absence de boutons : le formulaire
// d'intervention demandait le client en TEXTE LIBRE, donc `client_id` restait
// vide et l'ecran Clients devait proposer un rapprochement manuel. Le parcours
// sautait aussi du devis accepte directement a la facture, sans chantier, donc
// sans heures ni matieres a facturer depuis le reel.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const lire = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function stockage(db) {
  const donnees = new Map(db ? [["chantier_demo_v3", JSON.stringify(db)]] : []);
  return {
    donnees,
    getItem(cle) { return donnees.has(cle) ? donnees.get(cle) : null; },
    setItem(cle, valeur) { donnees.set(cle, String(valeur)); },
    removeItem(cle) { donnees.delete(cle); },
  };
}

function base() {
  return {
    entreprise: { nom: "Test", metier: "plombier" },
    employes: [{ id: "u_patron", nom: "Patron", role: "patron", couleur: "#fff" }],
    interventions: [], pointages: [], clients: [], catalogCategories: [], catalogItems: [],
    devis: [], devisLignes: [], factures: [], factureLignes: [], facturePaiements: [],
    sequencesDocuments: [], relances: [], stockEmplacements: [], stockMouvements: [],
    facturesFournisseurs: [], facturesFournisseursLignes: [],
    parametresRelance: { delaiDevis1: 5, delaiDevis2: 7, delaiFacture1: 30, delaiFacture2: 15, ton: "chaleureux" },
  };
}

function chargerDemo(db) {
  const localStorage = stockage(db);
  const contexte = {
    window: { Chantier: {}, alert() {}, console }, localStorage,
    setTimeout, clearTimeout, console, Date, Promise, Math, Intl, Uint8Array,
  };
  vm.createContext(contexte);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "api.js"), "utf8"), contexte);
  return { api: contexte.window.Chantier.backends.demo, localStorage };
}

test("un chantier cree avec un client choisi porte le lien, pas seulement un texte", async () => {
  const { api } = chargerDemo(base());
  const client = await api.createClient({ kind: "individual", displayName: "Mme Leroy", billingCountryCode: "FR" });
  const inter = await api.createIntervention({
    clientId: client.id, client: client.displayName,
    adresse: "3 rue des Lilas", tel: "06 11 22 33 44",
    date: "2026-09-01", description: "Ballon d'eau chaude",
  });
  const relu = await api.getIntervention(inter.id);
  assert.equal(relu.clientId, client.id, "le chantier doit etre RELIE au client, pas seulement le nommer");
  assert.equal(relu.client, "Mme Leroy");
});

test("le depannage ponctuel sans fiche client reste possible", async () => {
  const { api } = chargerDemo(base());
  const inter = await api.createIntervention({
    clientId: null, client: "Monsieur qui a appele ce matin",
    date: "2026-09-01", description: "Fuite",
  });
  assert.equal((await api.getIntervention(inter.id)).clientId, null);
});

test("un chantier peut etre rattache au devis qui l a declenche", async () => {
  const { api } = chargerDemo(base());
  const client = await api.createClient({ kind: "individual", displayName: "M. Bernard", billingCountryCode: "FR" });
  const devis = await api.createDevis({ titre: "Chaudiere", clientId: client.id });
  const inter = await api.createIntervention({ clientId: client.id, client: "M. Bernard", date: "2026-09-02" });
  await api.rattacherChantierAuDevis(inter.id, devis.id);
  assert.equal((await api.getIntervention(inter.id)).devisId, devis.id,
    "sans ce lien, la facturation depuis le reel n'a rien a lire");
});

test("le formulaire d'intervention propose la liste des clients et transmet le lien", () => {
  const app = lire("js/app.js");
  assert.match(app, /id="f-client-id"/, "le choix du client doit etre une liste, plus un texte libre");
  assert.match(app, /clientId: clientChoisi \? clientChoisi\.id : null/, "le lien doit partir dans le payload");
  assert.match(app, /Autre, saisir un nom/, "le depannage sans fiche doit rester possible");
});

test("la fiche client mene au devis, et le devis accepte mene au chantier", () => {
  const app = lire("js/app.js");
  assert.match(app, /id="client-vers-devis"/, "la fiche client doit proposer de creer un devis");
  assert.match(app, /devisPourClientId/, "le client choisi doit suivre jusqu'au formulaire de devis");
  assert.match(app, /Programmer l'intervention/, "le devis accepte doit proposer de programmer le chantier");
});

test("sur un devis accepte, le chantier passe AVANT la facture", () => {
  const app = lire("js/app.js");
  // On vise les BOUTONS, pas les commentaires : l'apostrophe est echappee dans
  // le source, et un premier jet de ce test comparait la position d'un
  // commentaire, ce qui le faisait echouer alors que le code etait juste.
  const iChantier = app.indexOf("<button class=\"primary\" type=\"button\">Programmer l\\'intervention");
  const iFacture = app.indexOf("const versFacture = el('<button class=\"ghost2\"");
  assert.ok(iChantier > 0, "le bouton Programmer l'intervention doit exister");
  assert.ok(iFacture > 0, "la facture recopiee doit etre devenue une action secondaire (ghost2)");
  assert.ok(iChantier < iFacture,
    "le chantier doit etre propose en premier : sans lui la facture ne peut que recopier le devis");
});

test("un element masque est vraiment masque", () => {
  // `.sheet-body label { display:flex }` ecrasait l'attribut hidden : le champ
  // « nom libre » serait reste visible sous la liste des clients.
  assert.match(lire("css/style.css"), /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});
