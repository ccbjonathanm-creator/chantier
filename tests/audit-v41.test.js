const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
function setup(initial = {}) {
  const map = new Map(Object.entries(initial));
  const localStorage = { get length() { return map.size; }, key: i => [...map.keys()][i], getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,String(v)), removeItem: k => map.delete(k) };
  const box = { window: { Chantier: {}, alert() {}, console }, localStorage, console, Date, Intl, Math, Promise, crypto: require('node:crypto').webcrypto, setTimeout: f => setTimeout(f,0), clearTimeout };
  vm.createContext(box); const load = f => vm.runInContext(fs.readFileSync(path.join(root,'js',f),'utf8'),box);
  load('securite-session.js'); load('api.js'); load('proposition.js'); load('pack-store.js');
  return { box, map, api: box.window.Chantier.api, proposition: box.window.Chantier.proposition };
}
const ligne = { libelle: 'Diagnostic', unite: 'forfait', quantite: 1, prixUnitaireHT: 95, tauxTVA: 20 };
async function dossier(api, lines = [ligne]) {
  const c = await api.createClient({kind:'individual',displayName:'TEST Régression'});
  const d = await api.createDevis({clientId:c.id,titre:'TEST Régression'});
  for (const l of lines) await api.addDevisLigne(d.id,l);
  for (const s of ['valide','envoye','accepte']) await api.changerStatutDevis(d.id,s);
  return { c,d };
}
test('les anciens contrats sont conservés sans être réattribués à une entreprise', async () => {
  const {map,box} = setup({chantier_contrats_v1:'[{"id":"ancien","client":"PRIVE"}]'});
  assert.equal(map.has('chantier_contrats_v1'),false);
  assert.match(map.get('chantier_ancien_non_attribue:chantier_contrats_v1'),/PRIVE/);
  const store=box.window.Chantier.packStore.creer('plombier',()=>({}),()=>[],()=>[]);
  assert.equal((await store.contrats()).length,0);
});
test('réinitialisation des packs démo : aucun contrat actif conservé, archive ancienne intacte', async () => {
  const {map,box}=setup({chantier_contrats_v1:'ancien'}); const store=box.window.Chantier.packStore.creer('plombier',()=>({}),()=>[],()=>[]);
  await store.saveContrat({id:'test',client:'DEMO',frequenceMois:12,montant:100});box.window.Chantier.securiteSession.purgerDemo();
  assert.equal((await store.contrats()).length,0);assert.equal(map.get('chantier_ancien_non_attribue:chantier_contrats_v1'),'ancien');
});
test('en mode cloud les packs passent exclusivement par le backend courant', async () => {
  const {map,box}=setup(); const data={A:[],B:[]};let tenant='A';
  box.window.Chantier.api={estCloud:true,listPackDonnees:async()=>data[tenant],savePackDonnee:async(p,c,v)=>{data[tenant].push(v);return v;}};
  const store=box.window.Chantier.packStore.creer('plombier',()=>({raisonSociale:'FAUX'}),()=>[],()=>[{client:'FAUX'}]);
  await store.saveContrat({id:'a',client:'PRIVE A',frequenceMois:12,montant:100});tenant='B';assert.equal((await store.contrats()).length,0);
  assert.equal([...map.keys()].some(k=>k.startsWith('chantier_demo_pack:')),false);
});
test('client vide, prix négatif et valeurs non finies refusés sans écriture', async () => {
  const {api}=setup(); const before=(await api.listClients()).length;
  await assert.rejects(()=>api.createClient({displayName:' '}));assert.equal((await api.listClients()).length,before);
  await assert.rejects(()=>api.createCatalogItem({label:'Négatif',unitPriceExclTax:-1}));
  const {d}=await dossier(api); const c=await api.createDevis({clientId:d.clientId,titre:'Brouillon'});
  for(const quantite of [Infinity,NaN,-1,0])await assert.rejects(()=>api.addDevisLigne(c.id,{...ligne,quantite}));
  await assert.rejects(()=>api.addDevisLigne(c.id,{...ligne,prixUnitaireHT:Infinity}));
  assert.equal((await api.getDevis(c.id)).lignes.length,0);
});
test('la virgule et le point décimal sont conservés dans les récits et devis',async()=>{
  const {proposition}=setup();
  for(const decimal of ['2,5','2.5']) {
    const v=await proposition.proposer('compte_rendu',{texte:'J’ai travaillé '+decimal+' heures sur place.'});assert.equal(v.champs.find(c=>c.cle==='heures').valeur,2.5);
    const d=await proposition.proposer('devis_lignes',{texte:'Pose '+decimal+' heures',catalogue:[]});assert.equal(d.champs[0].quantite,2.5);
  }
});
test('les clés IA sont séparées par profil et les anciennes clés ne sont pas réattribuées',()=>{
  const {box,map,api}=setup({chantier_ia_key:'ancienne-cle'});vm.runInContext(fs.readFileSync(path.join(root,'js/ia.js'),'utf8'),box);
  api.setSession('u_patron');assert.equal(box.window.Chantier.ia.getKey(),'');box.window.Chantier.ia.setKey('cle-patron');api.setSession('u_karim');assert.equal(box.window.Chantier.ia.getKey(),'');api.setSession('u_patron');assert.equal(box.window.Chantier.ia.getKey(),'cle-patron');assert.equal(map.get('chantier_ancien_non_attribue:chantier_ia_key'),'ancienne-cle');
});
test('la création au réel est atomique et peut être reprise après correction', async () => {
  const {api}=setup(),{d}=await dossier(api);
  await assert.rejects(()=>api.creerFactureDepuisReel(d.id,[ligne,{...ligne,quantite:-1}]));
  assert.equal((await api.listFactures()).filter(f=>f.devisId===d.id).length,0);
  const f=await api.creerFactureDepuisReel(d.id,[ligne]);assert.equal(f.totalTTC,114);
  await assert.rejects(()=>api.creerFactureDepuisDevis(d.id),/existe déjà/);
});
test('un forfait est conservé et aucun message Rien à facturer ne le contredit', async () => {
  const {api}=setup(),{d}=await dossier(api);const p=await api.proposerFactureReelle(d.id);
  assert.equal(p.lignes[0].origine,'forfait_devis');assert.equal(p.totalReel.ttc,114);assert.equal(p.ecarts.some(e=>e.type==='vide'),false);
});
test('un matériau prévu non posé reste exclu du réel',async()=>{
  const {api}=setup(); const article=await api.createCatalogItem({kind:'material',label:'Robinet',unit:'u',unitPriceExclTax:50,vatRate:20});
  const {d}=await dossier(api,[{...ligne,catalogItemId:article.id,unite:'u'}]);const p=await api.proposerFactureReelle(d.id);assert.equal(p.lignes.length,0);assert.ok(p.ecarts.some(e=>e.type==='non_pose'));
});
test('les anciens produits démo deviennent des matériaux éditables dans le catalogue',async()=>{
  const {api}=setup();const a=await api.createCatalogItem({kind:'product',label:'Matériau historique',unitPriceExclTax:20});assert.equal(a.kind,'material');assert.equal((await api.updateCatalogItem(a.id,{kind:'product'})).kind,'material');
});
test('une compensation annule le coût et la quantité du réel, sans modifier le journal',async()=>{
  const {api}=setup();const article=await api.createCatalogItem({kind:'material',label:'Robinet',unit:'u',unitPriceExclTax:50,purchasePriceExclTax:20,vatRate:20});
  const {c,d}=await dossier(api,[{...ligne,catalogItemId:article.id,unite:'u'}]);const e=(await api.listEmployes())[0];const i=await api.createIntervention({clientId:c.id,client:c.displayName,date:'2026-09-05',employeId:e.id});await api.rattacherChantierAuDevis(i.id,d.id);const l=await api.createEmplacement('TEST');
  await api.ajouterMouvementStock({catalogItemId:article.id,emplacementId:l.id,type:'entree',quantite:10,prixUnitaire:20});const m=await api.ajouterMouvementStock({catalogItemId:article.id,emplacementId:l.id,type:'consommation',quantite:-2,prixUnitaire:20,interventionId:i.id});await api.annulerMouvementStock(m.id,'Erreur');
  const reel=await api.reelDuChantier(d.id);assert.equal(reel.materiaux.length,0);assert.equal((await api.listMouvementsStock({interventionId:i.id})).length,2);
});
test('un pointage terminé est idempotent et exige un chantier existant',async()=>{
  const {api}=setup(),e=(await api.listEmployes())[0];await assert.rejects(()=>api.demarrerPointage('absent',e.id));
  const i=await api.createIntervention({client:'TEST',date:'2026-09-05',employeId:e.id});const p=await api.demarrerPointage(i.id,e.id);const fin=(await api.terminerPointage(p.id)).fin;await new Promise(r=>setTimeout(r,20));assert.equal((await api.terminerPointage(p.id)).fin,fin);
});
test('vendeur incomplet refusé, paramètres corrigés repris avant validation',async()=>{
  const {api}=setup(),{d}=await dossier(api),f=await api.creerFactureDepuisDevis(d.id);
  const params=await api.getParametresFacturation();await api.saveParametresFacturation({...params,vendeurSnapshot:{nom:'Incomplet'}});
  await assert.rejects(()=>api.changerStatutFacture(f.id,'valide'),/Document incomplet/);
  await api.saveParametresFacturation({...params,vendeurSnapshot:{nom:'TEST',siret:'00000000000000',adresse:'1 rue Test',codePostal:'71200',ville:'Test'}});
  await api.changerStatutFacture(f.id,'valide');const issued=await api.emettreFacture(f.id);assert.equal(issued.vendeurSnapshot.adresse,'1 rue Test');
});
test('le service worker laisse toutes les API et GET authentifiés au réseau',()=>{
  const listeners={},scope='https://exemple.test/chantier/';vm.runInNewContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),{URL,Set,self:{registration:{scope},addEventListener:(k,v)=>listeners[k]=v},caches:{},fetch(){throw Error('Ne doit pas intercepter');}});
  for(const [url,auth] of [[scope+'rest/v1/clients',false],['https://x.supabase.co/rest/v1/clients',false],[scope+'index.html',true]]){
    let intercepted=false;listeners.fetch({request:{method:'GET',url,headers:{has:()=>auth}},respondWith(){intercepted=true;}});assert.equal(intercepted,false);
  }
});
test('activation : purge des anciens caches ClicChantier sans effacer les autres applis',async()=>{
  const listeners={},deleted=[];let done;vm.runInNewContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),{URL,Set,self:{registration:{scope:'https://exemple.test/chantier/'},clients:{claim:async()=>{}},addEventListener:(k,v)=>listeners[k]=v},caches:{keys:async()=>['chantier-v40','chantier-v41','autre-app'],delete:async k=>deleted.push(k)}});
  listeners.activate({waitUntil:p=>done=p});await done;assert.deepEqual(deleted,['chantier-v40']);
});
