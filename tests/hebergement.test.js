const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('hébergement : en-têtes anti-cadre et résolution des assets sous /chantier/',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../hosting/worker.js'),'utf8');const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 let assetPath;const response=await worker.fetch(new Request('https://clicchantier.test/chantier/index.html'),{ASSETS:{fetch:async r=>{assetPath=new URL(r.url).pathname;return new Response('<!doctype html>',{headers:{'Content-Type':'text/html'}});}}});
 assert.equal(assetPath,'/index.html');assert.equal(response.headers.get('X-Frame-Options'),'DENY');assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.equal(response.headers.get('Cache-Control'),'no-cache');assert.equal(response.status,200);
});
