/* =====================================================================
   EO GN 2026 — Service worker (sw.js)
   Rôle : rendre le simulateur installable comme une application et
   utilisable hors connexion une fois chargé.

   Stratégies :
   - Page (index.html)        : réseau d'abord, copie en cache en secours.
                                → toute nouvelle version déposée sur le serveur
                                  est servie dès que le poste est en ligne.
   - Manifeste et icônes      : cache d'abord.
   - Bibliothèques et polices : cache d'abord, rafraîchies en arrière-plan
     (cdnjs, jsDelivr, Google Fonts).

   Maintenance : incrémenter VERSION à chaque modification de CE fichier
   ou de la liste des fichiers ci-dessous. Une mise à jour d'index.html
   seule ne demande pas de changer VERSION.
   Tous les chemins sont relatifs : la plateforme fonctionne à la racine
   d'un domaine comme dans un sous-dossier (ex. GitHub Pages).
   ===================================================================== */
const VERSION = 'eogn2026-v1';
const CACHE_APP = VERSION + '-app';
const CACHE_LIB = VERSION + '-lib';

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

/* Mêmes versions que dans index.html (voir la fiche de passation). */
const LIB_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js',
  'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700&display=swap'
];

const LIB_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

/* ---------- Installation : mise en cache initiale ---------- */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const app = await caches.open(CACHE_APP);
    await app.addAll(APP_FILES);
    // Les bibliothèques externes ne doivent jamais faire échouer l'installation.
    const lib = await caches.open(CACHE_LIB);
    await Promise.all(LIB_FILES.map(async url => {
      try {
        const res = await fetch(new Request(url, { mode: 'no-cors' }));
        if (res && (res.ok || res.type === 'opaque')) await lib.put(url, res);
      } catch (e) { /* hors ligne ou CDN indisponible : sera mis en cache à l'usage */ }
    }));
    await self.skipWaiting();
  })());
});

/* ---------- Activation : suppression des anciens caches ---------- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k.startsWith('eogn2026-') && k !== CACHE_APP && k !== CACHE_LIB)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ---------- Interception des requêtes ---------- */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1. Ouverture de la page : réseau d'abord, cache en secours.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstPage(req));
    return;
  }

  // 2. Fichiers de la plateforme (manifeste, icônes) : cache d'abord.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, CACHE_APP));
    return;
  }

  // 3. Bibliothèques et polices : cache d'abord, rafraîchissement en arrière-plan.
  if (LIB_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, event));
  }
  // Toute autre requête suit le comportement normal du navigateur.
});

async function networkFirstPage(req) {
  const cache = await caches.open(CACHE_APP);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put('./index.html', res.clone());
    return res;
  } catch (e) {
    return (await cache.match('./index.html')) ||
           (await cache.match('./')) ||
           new Response(
             '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
             '<title>EO GN 2026</title><body style="font-family:Arial,sans-serif;padding:32px;color:#1F1F21">' +
             '<h2 style="color:#A6192E">Connexion requise</h2>' +
             '<p>Le simulateur EO GN 2026 n\'a pas encore été chargé sur ce poste. ' +
             'Connectez-vous une première fois à Internet pour l\'utiliser ensuite hors connexion.</p></body>',
             { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return Response.error();
  }
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CACHE_LIB);
  const hit = await cache.match(req);
  const refresh = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return (await refresh) || Response.error();
}
