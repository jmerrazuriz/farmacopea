// Service worker: la app abre sin conexion. El build sustituye los marcadores de abajo (version y archivos).
const VERSION = '202610271817';
const SHELL = `shell-${VERSION}`;
const DATA = 'data-v1';
const SHELL_FILES = ["./","./index.html","./app.js","./static-api.js","./styles.css","./config.js","./manifest.webmanifest","./shared/derive.mjs","./shared/interactions-core.mjs","./shared/label.mjs","./icons/icon-192.png","./icons/icon-512.png","./icons/apple-touch-icon.png","./data/index.json"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // openFDA etc.: directo a la red

  // Datos (fichas, indice, traducciones): se sirven de la cache y se actualizan en segundo plano
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      caches.open(DATA).then(async (cache) => {
        const hit = await cache.match(req);
        const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // Aplicacion: cache primero, red como respaldo
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
