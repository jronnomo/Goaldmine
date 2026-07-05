// SPIKE (AS-0) — Web Push viability spike service worker.
// Push-only: NO fetch handler, NO caching, NO precache. Deletable in one
// `git rm public/spike-sw.js` once the GO/NO-GO verdict lands.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let title = "Goaldmine coach";
  let body = "Test nudge from the Web Push spike";

  try {
    const data = event.data ? event.data.json() : null;
    if (data) {
      if (typeof data.title === "string") title = data.title;
      if (typeof data.body === "string") body = data.body;
    }
  } catch {
    // Not JSON — fall back to plain text as the body.
    if (event.data) {
      try {
        body = event.data.text();
      } catch {
        // Leave the default body if even .text() fails.
      }
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) return client.focus();
        }
        return self.clients.openWindow("/");
      }),
  );
});
