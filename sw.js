/* Service worker Chantier : reseau d'abord sur le code (MAJ auto), cache en secours. */
const CACHE = "chantier-v37";
const ASSETS = [
  './mesure.js',
  "./",
  "./index.html",
  "./garde-style.js",
  "./css/style.css?v=37",
  "./css/premium.css",
  "./assets/clicchantier-3d-hero.webp",
  "./vendor/supabase.js",
  "./js/icons-premium.js",
  "./js/api.js?v=37",
  "./js/backend-supabase.js?v=37",
  "./js/ia.js",
  "./js/documents.js?v=37",
  "./js/plombier.js?v=37",
  "./js/electricien.js?v=37",
  "./js/peintre.js?v=37",
  "./js/modules-gestion.js?v=37",
  "./js/proposition.js",
  "./js/abonnement.js?v=37",
  "./js/app.js?v=37",
  "./install-pwa.js?v=37",
  "./manifest.json",
  "./favicon.ico",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match("./index.html") : Response.error())))
  );
});
