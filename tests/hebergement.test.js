const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('hébergement : en-têtes anti-cadre et résolution des assets sous /chantier/',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../hosting/worker.js'),'utf8');const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 let assetPath;const response=await worker.fetch(new Request('https://clicchantier.test/chantier/index.html'),{ASSETS:{fetch:async r=>{assetPath=new URL(r.url).pathname;return new Response('<!doctype html>',{headers:{'Content-Type':'text/html'}});}}});
 assert.equal(assetPath,'/index.html');assert.equal(response.headers.get('X-Frame-Options'),'DENY');assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.equal(response.headers.get('Cache-Control'),'no-cache');assert.equal(response.status,200);
});
test('ancienne adresse : purge privée et conservation du lien de récupération',async()=>{
 const vm=require('node:vm'),deleted=[];let destination,registered;
 const location=new URL('https://ccbjonathanm-creator.github.io/chantier/#type=recovery&access_token=JETON-FICTIF');location.replace=u=>destination=u;
 const window={};window.top=window;window.self=window;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/hebergement.js'),'utf8'),{window,location,URL,URLSearchParams,Promise,localStorage:{getItem:()=>null},navigator:{serviceWorker:{register:async u=>{registered=u;return {update:async()=>{}};}}},caches:{keys:async()=>['chantier-v40','autre-application'],delete:async k=>deleted.push(k)}});
 await new Promise(r=>setTimeout(r,0));assert.deepEqual(deleted,['chantier-v40']);assert.equal(registered,'/chantier/sw.js');assert.equal(new URL(destination).hostname,'clicchantier.contactweb71.workers.dev');assert.equal(new URL(destination).hash,location.hash);
});
