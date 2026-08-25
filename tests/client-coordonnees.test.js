// Verrouille le defaut trouve par Jonathan a l'usage le 2026-08-25 :
// l'ecran de relance pre-remplissait le destinataire avec `client.email`,
// mais AUCUNE colonne e-mail n'existait sur les clients et le formulaire
// n'en demandait pas. Le champ etait donc toujours vide, et il fallait
// retaper l'adresse a chaque relance.
//
// Rien ne signalait l'erreur : `undefined` s'affichait comme une chaine
// vide au lieu de planter. Ces tests refont le chemin complet, de la
// creation du client jusqu'a la valeur que l'ecran de relance lit.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

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

const lire = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("un client cree avec une adresse e-mail la conserve a la relecture", async () => {
  const { api } = chargerDemo(base());
  const cree = await api.createClient({
    kind: "individual", displayName: "Mme Leroy",
    email: "leroy@exemple.invalid", telephone: "06 11 22 33 44",
    billingCountryCode: "FR",
  });
  const relu = await api.getClient(cree.id);
  assert.equal(relu.email, "leroy@exemple.invalid");
  assert.equal(relu.telephone, "06 11 22 33 44");
});

test("l'adresse e-mail reste modifiable apres coup", async () => {
  const { api } = chargerDemo(base());
  const cree = await api.createClient({ kind: "individual", displayName: "M. Bernard", billingCountryCode: "FR" });
  assert.ok(!cree.email, "un client sans e-mail doit rester possible");
  await api.updateClient(cree.id, { email: "bernard@exemple.invalid" });
  assert.equal((await api.getClient(cree.id)).email, "bernard@exemple.invalid");
});

test("le client de la cible a relancer porte son adresse, c'est ce que lit l'ecran", async () => {
  const db = base();
  db.clients.push({
    id: "c1", kind: "individual", displayName: "Mme Leroy",
    email: "leroy@exemple.invalid", billingCountryCode: "FR",
  });
  const vieux = new Date(Date.now() - 30 * 86400000).toISOString();
  db.devis.push({ id: "d1", clientId: "c1", titre: "Ballon d'eau chaude", statut: "envoye", envoyeLe: vieux, createdAt: vieux, totalTTC: 1200 });
  const { api } = chargerDemo(db);

  const cibles = await api.ciblesARelancer();
  const cible = cibles.find((c) => c.cible.id === "d1");
  assert.ok(cible, "le devis de 30 jours doit etre a relancer");
  // C'est exactement l'expression evaluee par le gabarit de js/app.js.
  assert.equal(cible.client && cible.client.email, "leroy@exemple.invalid");
});

test("le formulaire client demande bien une adresse e-mail", () => {
  const app = lire("js/app.js");
  assert.match(app, /id="client-email"/, "le champ e-mail doit exister dans la fiche client");
  assert.match(app, /email: root\.querySelector\("#client-email"\)/, "le champ doit etre lu dans le payload envoye a l'API");
});

test("le backend Supabase lit et ecrit les deux colonnes", () => {
  const backend = lire("js/backend-supabase.js");
  assert.match(backend, /email: c\.email \|\| ""/, "mapClient doit exposer l'e-mail au reste de l'application");
  assert.match(backend, /email: \(c\.email \|\| ""\)\.trim\(\) \|\| null/, "clientRow doit ecrire null et pas une chaine vide");
});

// La migration SQL correspondante vit dans l'AUTRE depot, a
// `jarvis-starter-kit/chantier_app/supabase/23_client_email_telephone.sql`.
// Elle n'est pas testee ici : un test qui lit un fichier hors du depot
// passerait sur ce PC et echouerait partout ailleurs. C'est une dette
// connue, le produit est reparti sur deux depots.
