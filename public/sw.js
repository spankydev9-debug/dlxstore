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
