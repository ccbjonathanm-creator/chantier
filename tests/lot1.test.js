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

function chargerDemo(localStorage, alertes) {
  const contexte = {
    window: { Chantier: {}, alert(message) { alertes.push(message); } },
    localStorage, setTimeout, clearTimeout, console, Date, Promise, Math, Intl,
  };
  vm.createContext(contexte);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "api.js"), "utf8"), contexte);
  return contexte.window.Chantier.backends.demo;
}

test("une sauvegarde locale corrompue est conservée et signalée avant réinitialisation", async () => {
  const valeurCorrompue = '{"clients":[{"nom":"Martin"}]';
  const localStorage = stockage({ chantier_demo_v3: valeurCorrompue });
  const alertes = [];
  const api = chargerDemo(localStorage, alertes);

  const clients = await api.listClients();
  const secours = [...localStorage.donnees.keys()].filter((cle) =>
    cle.startsWith("chantier_demo_v3.corrompu."));

  assert.ok(clients.length > 0, "la démonstration repart après la copie de secours");
  assert.equal(secours.length, 1, "une seule copie horodatée est créée");
  assert.equal(localStorage.getItem(secours[0]), valeurCorrompue, "la valeur brute est préservée à l'identique");
  assert.doesNotThrow(() => JSON.parse(localStorage.getItem("chantier_demo_v3")));
  assert.equal(alertes.length, 1, "l'utilisateur est prévenu une fois");
  assert.match(alertes[0], /copie a été conservée/);
  assert.match(alertes[0], /chantier_demo_v3\.corrompu\./);
});

test("si la copie de secours échoue, la sauvegarde corrompue n'est pas remplacée", async () => {
  const valeurCorrompue = "{incomplet";
  const base = stockage({ chantier_demo_v3: valeurCorrompue });
  const localStorage = {
    getItem: base.getItem,
    removeItem: base.removeItem,
    setItem(cle, valeur) {
      if (cle.startsWith("chantier_demo_v3.corrompu.")) throw new Error("quota");
      base.setItem(cle, valeur);
    },
  };
  const api = chargerDemo(localStorage, []);

  await assert.rejects(() => api.listClients(), /Rien n'a été remplacé/);
  assert.equal(base.getItem("chantier_demo_v3"), valeurCorrompue);
});

function requete(table) {
  const q = {
    select() { return q; }, eq() { return q; }, is() { return q; }, order() { return q; }, limit() { return q; },
    maybeSingle() {
      if (table === "profils") return Promise.resolve({ data: { id: "u1", nom: "Jean", role: "patron", couleur: "#fff", entreprise_id: "e1" }, error: null });
      if (table === "entreprises") return Promise.resolve({ data: null, error: { message: "column entreprises.metier does not exist" } });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return q;
}

test("une incompatibilité du schéma cloud remonte un message destiné à l'artisan", async () => {
  const client = {
    auth: {
      onAuthStateChange() {},
      getSession() { return Promise.resolve({ data: { session: { user: { id: "u1" } } } }); },
    },
    realtime: { setAuth() {} },
    from(table) { return requete(table); },
  };
  const contexte = {
    window: { Chantier: {} },
    localStorage: stockage(), console, Date, Promise, Math, Intl,
    supabase: { createClient() { return client; } },
  };
  vm.createContext(contexte);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "backend-supabase.js"), "utf8"), contexte);

  await assert.rejects(
    () => contexte.window.Chantier.backends.supabase.init(),
    /Impossible de charger votre entreprise.*base en ligne doit être mise à jour/,
  );
});

test("le routeur possède un écran de repli global et intercepte les rejets asynchrones", () => {
  const source = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  assert.match(source, /function afficherErreurGlobale\(error\)/);
  assert.match(source, /return await renderInterne\(\)/);
  assert.match(source, /if \(!state\.me\) return renderLogin\(\)/);
  assert.match(source, /Impossible de charger vos données/);
  assert.match(source, /if \(erreurDemarrage\) \{[\s\S]*afficherErreurGlobale\(erreurDemarrage\)/);
});
