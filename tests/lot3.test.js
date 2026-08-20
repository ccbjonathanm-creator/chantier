const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function stockage(db) {
  const donnees = new Map([["chantier_demo_v3", JSON.stringify(db)]]);
  return {
    donnees,
    getItem(cle) { return donnees.has(cle) ? donnees.get(cle) : null; },
    setItem(cle, valeur) { donnees.set(cle, String(valeur)); },
    removeItem(cle) { donnees.delete(cle); },
  };
}

function base(factures, pointages) {
  return {
    employes: [{ id: "u1", nom: "Test", role: "patron", couleur: "#fff" }],
    interventions: [{ id: "i1", employeId: "u1", date: "2026-08-20", dateFin: "2026-08-20", statut: "planifie" }],
    pointages: pointages || [], clients: [], catalogCategories: [], catalogItems: [],
    devis: [], devisLignes: [], factures: factures || [], factureLignes: [],
    facturePaiements: [], sequencesDocuments: [], relances: [], stockEmplacements: [],
    stockMouvements: [], facturesFournisseurs: [], facturesFournisseursLignes: [],
  };
}

function factureEmise() {
  return {
    id: "f1", clientId: "c1", devisId: null, genre: "facture", avoirDe: null,
    numero: "F2026-0001", statut: "emise", dateEmission: "2026-08-20",
    clientSnapshot: { nom: "Client", kind: "individual" },
    vendeurSnapshot: { nom: "Artisan" }, conditionsPaiement: "Comptant",
    penalitesRetard: "", indemniteRecouvrement: null, mentionTva: "",
    totalHT: 1000, totalTVA: 100, totalTTC: 1100,
    valideLe: "2026-08-20T08:00:00Z", validePar: "u1",
    emiseLe: "2026-08-20T09:00:00Z", annuleeLe: null, createdAt: "2026-08-20T08:00:00Z",
  };
}

function charger(db) {
  const localStorage = stockage(db);
  const contexte = {
    window: { Chantier: {}, alert() {} }, localStorage,
    setTimeout, clearTimeout, console, Date, Promise, Math, Intl,
  };
  vm.createContext(contexte);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "api.js"), "utf8"), contexte);
  return { api: contexte.window.Chantier.backends.demo, localStorage };
}

const ligne330 = { libelle: "Correction", unite: "forfait", quantite: 1, prixUnitaireHT: 300, tauxTVA: 10 };
const ligne770 = { libelle: "Correction", unite: "forfait", quantite: 1, prixUnitaireHT: 700, tauxTVA: 10 };

test("un paiement postérieur à un avoir ne peut jamais rendre le solde négatif", async () => {
  const { api } = charger(base([factureEmise()]));
  const avoir = await api.creerAvoir("f1", [ligne330]);
  await api.changerStatutFacture(avoir.id, "valide", "u1");
  await api.emettreFacture(avoir.id);

  await assert.rejects(() => api.enregistrerPaiement("f1", { montant: 1100 }), /solde réel/);
  const solde = await api.soldeFacture("f1");
  assert.equal(solde.totalTTC, 1100);
  assert.equal(solde.totalPaye, 0);
  assert.equal(solde.totalAvoirs, 330);
  assert.equal(solde.resteDu, 770);
});

test("le second de deux avoirs brouillons trop élevés est refusé à l'émission", async () => {
  const { api } = charger(base([factureEmise()]));
  const premier = await api.creerAvoir("f1", [ligne770]);
  const second = await api.creerAvoir("f1", [ligne770]);
  await api.changerStatutFacture(premier.id, "valide", "u1");
  await api.changerStatutFacture(second.id, "valide", "u1");
  await api.emettreFacture(premier.id);

  await assert.rejects(() => api.emettreFacture(second.id), /solde réel/);
  assert.equal((await api.listAvoirsDe("f1")).find((a) => a.id === second.id).statut, "valide");
  assert.equal((await api.soldeFacture("f1")).resteDu, 330);
});

test("un avoir tient compte des paiements déjà reçus dès sa création", async () => {
  const db = base([factureEmise()]);
  db.facturePaiements.push({ id: "p1", factureId: "f1", montant: 500, payeLe: "2026-08-20", moyen: "virement", note: "" });
  const { api, localStorage } = charger(db);

  await assert.rejects(() => api.creerAvoir("f1", [ligne770]), /solde réel/);
  const sauve = JSON.parse(localStorage.getItem("chantier_demo_v3"));
  assert.equal(sauve.factures.filter((f) => f.genre === "avoir").length, 0, "aucun brouillon orphelin n'est conservé");
});

test("un pointage ordinaire se ferme exactement au début du suivant", async () => {
  const maintenant = Date.now();
  const { api } = charger(base([], []));
  const premier = await api.demarrerPointage("i1", "u1", maintenant - 10 * 3600000);
  const debutSuivant = maintenant - 1000;
  await api.demarrerPointage("i1", "u1", debutSuivant);
  const pointages = await api.listPointages({ employeId: "u1" });
  assert.equal(pointages.find((p) => p.id === premier.id).fin, debutSuivant);
});

test("au-delà de 12 heures, une fin explicite est exigée avant le pointage suivant", async () => {
  const maintenant = Date.now();
  const { api } = charger(base([], []));
  const debutOublie = maintenant - 25 * 3600000;
  const nouveauDebut = maintenant - 1000;
  const premier = await api.demarrerPointage("i1", "u1", debutOublie);

  await assert.rejects(
    () => api.demarrerPointage("i1", "u1", nouveauDebut),
    (e) => e.code === "pointage-oublie" && e.nouveauDebut === nouveauDebut,
  );
  assert.equal((await api.pointageEnCours("u1")).id, premier.id, "l'erreur ne modifie pas le pointage ouvert");

  const finChoisie = debutOublie + 8 * 3600000;
  const suivant = await api.demarrerPointage("i1", "u1", nouveauDebut, finChoisie);
  const pointages = await api.listPointages({ employeId: "u1" });
  assert.equal(pointages.find((p) => p.id === premier.id).fin, finChoisie);
  assert.equal(suivant.debut, nouveauDebut);
  assert.ok(finChoisie <= suivant.debut, "les deux pointages ne se chevauchent pas");
});

test("les vues Mois et Année calculent et affichent les heures pointées", () => {
  const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  assert.match(app, /function totalPointages\(pointages, from, to\)/);
  assert.match(app, /heuresMois = totalPointages/);
  assert.match(app, /heuresAnnee = totalPointages/);
  assert.match(app, /heuresDuMois = totalPointages/);
  assert.match(app, /pointées/);
  assert.match(app, /e\.code === "pointage-oublie"[\s\S]*Indiquez son heure de fin/);
});
