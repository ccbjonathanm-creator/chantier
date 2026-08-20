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
    employes: [
      { id: "u_patron", nom: "Patron", role: "patron", couleur: "#fff" },
      { id: "u_emp", nom: "Employé", role: "employe", couleur: "#aaa" },
    ],
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

test("la deuxième relance respecte le délai configuré après l'envoi de la première", async () => {
  const db = base();
  db.devis.push({ id: "d1", clientId: "c1", titre: "Test", statut: "envoye", envoyeLe: "2026-08-01T08:00:00Z", createdAt: "2026-08-01T08:00:00Z" });
  db.relances.push({
    id: "r1", cibleType: "devis", devisId: "d1", factureId: null,
    niveau: 1, statut: "envoyee", message: "Première", envoyeeLe: new Date().toISOString(),
  });
  const { api, localStorage } = chargerDemo(db);

  await assert.rejects(() => api.preparerRelance("devis", "d1", 2, "Deuxième"), /disponible dans 7 jours/);
  const sauve = JSON.parse(localStorage.getItem("chantier_demo_v3"));
  sauve.relances[0].envoyeeLe = new Date(Date.now() - 8 * 86400000).toISOString();
  localStorage.setItem("chantier_demo_v3", JSON.stringify(sauve));
  const relance = await api.preparerRelance("devis", "d1", 2, "Deuxième");
  assert.equal(relance.niveau, 2);
});

test("un employé démo ne peut pas appeler directement une action patron", async () => {
  const db = base();
  const { api } = chargerDemo(db);
  api.setSession("u_emp");
  await assert.rejects(
    async () => api.createIntervention({ date: "2026-08-20", client: "Client" }),
    /réservée au patron/,
  );
  assert.equal((await api.listInterventions({})).length, 0);
});

test("clients et articles inutilisés sont archivables, les références utilisées sont protégées", async () => {
  const db = base();
  db.clients.push(
    { id: "c_libre", displayName: "Libre", kind: "individual" },
    { id: "c_utilise", displayName: "Utilisé", kind: "individual" },
  );
  db.catalogItems.push(
    { id: "a_libre", label: "Libre", unit: "u", unitPriceExclTax: 1 },
    { id: "a_utilise", label: "Utilisé", unit: "u", unitPriceExclTax: 1 },
  );
  db.interventions.push({ id: "i1", clientId: "c_utilise", date: "2026-08-20", dateFin: "2026-08-20" });
  db.devisLignes.push({ id: "l1", devisId: "d1", catalogItemId: "a_utilise" });
  const { api } = chargerDemo(db);

  await api.archiveClient("c_libre");
  await api.archiveCatalogItem("a_libre");
  await assert.rejects(() => api.archiveClient("c_utilise"), /utilisé par un chantier/);
  await assert.rejects(() => api.archiveCatalogItem("a_utilise"), /utilisé dans un document/);
  assert.deepEqual(Array.from(await api.listClients(), (c) => c.id), ["c_utilise"]);
  assert.deepEqual(Array.from(await api.listCatalogItems(), (a) => a.id), ["a_utilise"]);
});

test("les brouillons retirés ne s'accumulent plus dans les listes", async () => {
  const db = base();
  db.devis.push({ id: "d1", clientId: "c1", titre: "Brouillon", statut: "brouillon", createdAt: "2026-08-20T08:00:00Z" });
  db.factures.push({ id: "f1", clientId: "c1", genre: "facture", statut: "brouillon", createdAt: "2026-08-20T08:00:00Z" });
  const { api } = chargerDemo(db);
  await api.archiverDevisBrouillon("d1");
  await api.changerStatutFacture("f1", "annulee", "u_patron");
  assert.equal((await api.listDevis()).length, 0);
  assert.equal((await api.listFactures()).length, 0);
});

test("un exécutable renommé en PDF est refusé par sa signature", async () => {
  const { api } = chargerDemo(base());
  const octets = Uint8Array.from([0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0]);
  await assert.rejects(() => api.importerFactureFournisseur({
    nom: "piege.pdf", typeMime: "application/pdf", tailleOctets: octets.length,
    contenu: { async arrayBuffer() { return octets.buffer; } },
  }), /ne correspond pas au format annoncé/);
  assert.equal((await api.listFacturesFournisseurs()).length, 0);
});

test("navigation, brouillon client, facture existante et libellés d'avoir sont corrigés dans l'UI", () => {
  const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const plomberie = fs.readFileSync(path.join(root, "js", "plombier.js"), "utf8");
  assert.match(app, /CLIENT_DRAFT_KEY/);
  assert.match(app, /Brouillon restauré après le rechargement/);
  assert.match(app, /history\.pushState\(\{ clicchantierModule: cle \}/);
  assert.match(app, /addEventListener\("popstate"/);
  assert.match(app, /event\.key !== "chantier_demo_v3"/);
  assert.match(app, /Une facture existe déjà pour ce devis/);
  assert.match(app, /Valider \$\{estAvoir \? "l'avoir" : "la facture"\}/);
  assert.match(plomberie, /class="pl-back" id="pl-back" data-retour/);
  assert.match(app, /\[data-retour\], \.pl-back/);
});

test("inscription et installation n'annoncent plus trop tôt un succès ou une bannière", () => {
  const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const pwa = fs.readFileSync(path.join(root, "install-pwa.js"), "utf8");
  assert.doesNotMatch(app, /Compte créé\. Ouvrez l'e-mail/);
  assert.match(app, /Si cette adresse vient d'être inscrite ou attend déjà une confirmation/);
  assert.match(pwa, /if \(!explorationReady\) return/);
  assert.match(app, /}, 12000\)/);
});

test("les détails visuels sont lisibles, accentués et dotés d'un favicon valide", () => {
  const css = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");
  const tailles = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(tailles.length > 20);
  assert.ok(tailles.every((taille) => taille >= 13), "aucune taille fixe ne doit rester sous 13 px");
  const textes = [
    fs.readFileSync(path.join(root, "js", "app.js"), "utf8"),
    fs.readFileSync(path.join(root, "js", "plombier.js"), "utf8"),
    fs.readFileSync(path.join(root, "install-pwa.js"), "utf8"),
  ].join("\n");
  ["Itinéraire", "pointées", "Vos outils métier", "Entretiens à prévoir", "Bientôt", "même hors-ligne"]
    .forEach((mot) => assert.match(textes, new RegExp(mot)));
  const favicon = fs.readFileSync(path.join(root, "favicon.ico"));
  assert.deepEqual([...favicon.subarray(0, 6)], [0, 0, 1, 0, 1, 0]);
});

test("le cloud possède les mêmes gardes que la démonstration", () => {
  const cloud = fs.readFileSync(path.join(root, "js", "backend-supabase.js"), "utf8");
  ["archiveClient", "archiveCatalogItem", "archiverDevisBrouillon", "verifierSignatureFichier"]
    .forEach((nom) => assert.match(cloud, new RegExp(nom)));
  assert.match(cloud, /Deuxième relance disponible dans/);
  assert.match(cloud, /\.neq\("statut", "annulee"\)/);
});
