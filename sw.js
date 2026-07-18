/* Service worker Chantier : reseau d'abord sur le code (MAJ auto), cache en secours. */
const CACHE = "chantier-v21";
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./vendor/supabase.js",
  "./js/api.js",
  "./js/backend-supabase.js",
  "./js/ia.js",
  "./js/plombier.js",
  "./js/electricien.js",
  "./js/peintre.js",
  "./js/app.js",
  "./manifest.json",
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
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});
