const CACHE_NAME = "safesleep-shell-v4";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png"
];

// Install: Cache core application shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn("Service worker cache.addAll partial error:", err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: Clean up old caches immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("SafeSleep: Removing old cache:", key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch: Network-First strategy (always load latest UI from server when connected; fall back to cache when offline)
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Always use network directly for API calls, geocoding, and routing
  if (
    url.pathname.startsWith("/api") ||
    url.hostname.includes("nominatim") ||
    url.hostname.includes("osrm") ||
    url.hostname.includes("overpass") ||
    event.request.method !== "GET"
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          networkResponse.type === "basic"
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Network failed (offline travel mode) -> serve cached shell
        return caches.match(event.request);
      })
  );
});
