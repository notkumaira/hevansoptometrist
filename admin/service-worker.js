const CACHE_NAME = "h-evans-staff-shell-v5";
const APP_SHELL = ["/admin/", "/admin/manifest.webmanifest", "/admin/icons/staff-app.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(data.title || "H Evans Optometrist", {
      body: data.body || "A new appointment request has arrived.",
      icon: "/admin/icons/staff-app.svg",
      badge: "/admin/icons/staff-app.svg",
      data: { url: "/admin/" },
      tag: "h-evans-new-appointment",
      renotify: true
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL("/admin/", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin + "/admin")) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never cache API responses or non-GET requests: appointment and patient data
  // must always be fetched from the live, authenticated backend.
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate" && url.pathname === "/admin/") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("/admin/", copy));
          }
          return response;
        })
        .catch(() => caches.match("/admin/"))
    );
    return;
  }

  if (APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
  }
});
