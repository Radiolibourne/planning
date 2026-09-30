// Service worker : ouverture du site hors connexion.
// - Page et icônes : réseau d'abord (pour recevoir les mises à jour), copie locale si pas de réseau.
// - Bibliothèque Firebase (versionnée) : copie locale d'abord.
// - Données (Firestore) : non concernées ici, gardées par le cache local de Firestore.
const VERSION = "__VERSION__";
const CACHE = "planning-radio-" + VERSION;
const COQUILLE = ["./", "./index.html", "./manifest.webmanifest", "./icone-180.png", "./icone-192.png", "./icone-512.png", "./favicon-32.png"];
const FIREBASE = /^https:\/\/www\.gstatic\.com\/firebasejs\//;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("planning-radio-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function reseauDAbord(req) {
  return fetch(req).then((rep) => {
    if (rep.ok) { const copie = rep.clone(); caches.open(CACHE).then((c) => c.put(req, copie)); }
    return rep;
  }).catch(() => caches.match(req, { ignoreSearch: true })
    .then((r) => r || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())));
}

function cacheDAbord(req) {
  return caches.match(req).then((r) => r || fetch(req).then((rep) => {
    if (rep.ok || rep.type === "opaque") { const copie = rep.clone(); caches.open(CACHE).then((c) => c.put(req, copie)); }
    return rep;
  }));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (FIREBASE.test(req.url)) { e.respondWith(cacheDAbord(req)); return; }
  if (url.origin === self.location.origin) { e.respondWith(reseauDAbord(req)); return; }
});
