/* Service worker Chantier : reseau d'abord sur le code (MAJ auto), cache en secours. */
const CACHE = "chantier-v41";
const ASSETS = [
  './mesure.js',
  "./",
  "./index.html",
  "./garde-style.js",
  "./css/style.css?v=41",
  "./css/premium.css",
  "./assets/clicchantier-3d-hero.webp",
  "./vendor/supabase.js",
  "./js/icons-premium.js",
  "./js/acces.js?v=41",
  "./js/hebergement.js?v=41",
  "./js/securite-session.js?v=41",
  "./js/pack-store.js?v=41",
  "./js/dialogues.js?v=41",
  "./js/api.js?v=41",
  "./js/backend-supabase.js?v=41",
  "./js/ia.js",
  "./js/documents.js?v=41",
  "./js/plombier.js?v=41",
  "./js/electricien.js?v=41",
  "./js/peintre.js?v=41",
  "./js/modules-gestion.js?v=41",
  "./js/proposition.js",
  "./js/abonnement.js?v=41",
  "./js/app.js?v=41",
  "./install-pwa.js?v=41",
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
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("chantier-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
const PUBLIC_ASSETS = new Set(ASSETS.map((p) => new URL(p, self.registration.scope).href));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Jamais de réponse métier/authentifiée dans le cache public de l'application.
  if (!PUBLIC_ASSETS.has(e.request.url) || e.request.headers.has("Authorization")) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match("./index.html") : Response.error())))
  );
});
