const VERSION = "creatix-movies-v1.3.0-static";
const APP_BASE = new URL("./", self.location.href).pathname;
const CACHE_PREFIX = `creatix-movies:${APP_BASE}:`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const appPath = (path = "") => new URL(path, self.registration.scope).pathname;
const APP_SHELL = [APP_BASE, appPath("manifest.webmanifest"), appPath("icons/icon.svg"), appPath("icons/icon-192.png"), appPath("icons/icon-512.png"), appPath("data/seed-catalog.json")];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    const html = await (await cache.match(APP_BASE)).text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^\"]*)?)"/g)]
      .map((match) => new URL(match[1], self.registration.scope))
      .filter((url) => url.origin === self.location.origin && url.pathname.startsWith(APP_BASE))
      .map((url) => url.href);
    if (assets.length) await cache.addAll([...new Set(assets)]);
    // Ces modules existent dans la distribution source, mais pas dans le build Vite.
    await Promise.allSettled(["src/catalog.js", "src/player.js"].map((path) => cache.add(appPath(path))));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("message", (event) => { if (event.data?.type === "SKIP_WAITING") self.skipWaiting(); });

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Aucune vidéo ni aucun lecteur tiers n'est stocké hors connexion.
  if (url.origin !== self.location.origin || !url.pathname.startsWith(APP_BASE) || request.destination === "video" || /\.(?:mp4|webm|m3u8|ts)$/i.test(url.pathname)) return;
  const isCatalog = [appPath("data/catalog.json"), appPath("data/seed-catalog.json")].includes(url.pathname);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const key = request.mode === "navigate" ? APP_BASE : isCatalog ? url.pathname : request;
    if (isCatalog || request.mode === "navigate") {
      try {
        const response = await fetch(request);
        if (!response.ok) throw new Error("Ressource indisponible");
        await cache.put(key, response.clone());
        return response;
      } catch {
        const cached = await cache.match(key);
        if (cached) return cached;
        if (isCatalog) {
          const seed = await cache.match(appPath("data/seed-catalog.json"));
          if (seed) return seed;
        }
        return new Response("Hors connexion", { status: 503 });
      }
    }
    const cached = await cache.match(key);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") await cache.put(key, response.clone());
      return response;
    } catch { return new Response("Hors connexion", { status: 503 }); }
  })());
});
