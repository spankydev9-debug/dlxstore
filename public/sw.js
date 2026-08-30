const CACHE = "dlxstore-shell-v3";
const SHELL = ["/", "/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith("dlxstore-") && key !== CACHE)
              .map((key) => caches.delete(key))
          )
        ),
    ])
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (
    request.method !== "GET" ||
    new URL(request.url).origin !== location.origin
  ) {
    return;
  }

  // Only provide the offline document fallback for page navigations.
  // Never replace failed JS, CSS, API, image, or other asset requests
  // with the /offline HTML page.
  if (request.mode !== "navigate") {
    return;
  }

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(request).then(
        (response) => response || caches.match("/offline")
      )
    )
  );
});
