const CACHE = "dlxstore-shell-v4";
const SHELL = ["/", "/offline"];
const STATIC_CACHE = "dlxstore-static-v4";

// Anything under these prefixes is per-account. We never write it to a cache and
// never serve it from one: the old version cached every same-origin navigation,
// so a signed-in /dashboard document stayed on disk and was replayed offline to
// whoever used the device next. Failing closed here matters more than saving bytes.
//
// This list must be extended when a private route is added.
const PRIVATE_PREFIXES = [
  "/dashboard",
  "/partner",
  "/admin",
  "/auth",
  "/chat",
  "/cart",
  "/checkout",
  "/account",
  "/orders",
  "/api",
];

function isPrivate(pathname) {
  return PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function isContentHashedStatic(url) {
  // Next fingerprints everything under /_next/static, so a cached copy can never
  // go stale. Same-origin only: Supabase Storage images stay network-first so the
  // verified image pipeline keeps behaving exactly as it does today.
  return (
    url.origin === self.location.origin &&
    url.pathname.startsWith("/_next/static/")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is atomic: one 404 and the whole install fails. Each entry is
      // cached individually so a missing shell page cannot break registration.
      .then((cache) =>
        Promise.all(
          SHELL.map((url) =>
            cache.add(new Request(url, { cache: "reload" })).catch(() => undefined)
          )
        )
      )
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
              .filter((key) => key.startsWith("dlxstore-") && ![CACHE, STATIC_CACHE].includes(key))
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
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== location.origin) {
    return;
  }

  // Fingerprinted build output: cache-first. This is the actual offline/perf win
  // and it cannot serve stale bytes, because a content change changes the path.
  if (isContentHashedStatic(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  // Per-account routes stay network-only in both directions.
  if (isPrivate(url.pathname)) {
    return;
  }

  // Only provide the offline document fallback for page navigations.
  // Never replace failed JS, CSS, API, image, or other asset requests
  // with the /offline HTML page.
  if (request.mode !== "navigate") {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only successful documents are stored; opaque/5xx responses are not.
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(
          (response) => response || caches.match("/offline")
        )
      )
  );
});


// Push Notification Support
self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    
    const options = {
      body: data.body,
      icon: data.icon || "/icons/icon-192x192.png",
      badge: "/icons/badge-72x72.png",
      tag: data.tag,
      data: data.data,
      actions: data.actions,
      requireInteraction: data.requireInteraction,
      silent: data.silent || false,
    };

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  } catch (error) {
    console.error("Error handling push event:", error);
    
    // Fallback notification
    const options = {
      body: "New message received",
      icon: "/icons/icon-192x192.png",
      badge: "/icons/badge-72x72.png",
      tag: "chat-notification",
    };

    event.waitUntil(
      self.registration.showNotification("DLX Chat", options)
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data;
  const action = event.action;

  // Handle different actions
  if (action === "open") {
    // Open the chat conversation
    if (data?.conversationId) {
      event.waitUntil(
        clients.openWindow(`/chat?conversation=${data.conversationId}`)
      );
    } else {
      event.waitUntil(
        clients.openWindow("/chat")
      );
    }
  } else if (action === "mark_read") {
    // Mark conversation as read
    if (data?.conversationId) {
      // Send message to all clients to mark conversation as read
      event.waitUntil(
        clients.matchAll().then((clientList) => {
          clientList.forEach((client) => {
            client.postMessage({
              type: "MARK_CONVERSATION_READ",
              conversationId: data.conversationId,
            });
          });
        })
      );
    }
  } else {
    // Default click behavior - focus/open chat
    event.waitUntil(
      clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      }).then((clientList) => {
        // Check if chat window is already open
        for (const client of clientList) {
          if (client.url.includes("/chat") && "focus" in client) {
            return client.focus();
          }
        }
        
        // If no chat window found, open new one
        if (data?.conversationId) {
          return clients.openWindow(`/chat?conversation=${data.conversationId}`);
        } else {
          return clients.openWindow("/chat");
        }
      })
    );
  }
});

self.addEventListener("notificationclose", (event) => {
  // Notification was closed without clicking
  const data = event.notification.data;
  console.log("Notification closed:", data);
});
