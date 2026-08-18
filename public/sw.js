const CACHE = "dlxstore-shell-v2";
const SHELL = ["/", "/offline"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))));
self.addEventListener("activate", (event) => event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("dlxstore-") && key !== CACHE).map((key) => caches.delete(key))))])));
self.addEventListener("message", (event) => { if (event.data?.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("fetch", (event) => { if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return; event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((response) => response || caches.match("/offline")))); });
