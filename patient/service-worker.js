const CACHE_NAME = "h-evans-patient-shell-v1";
const APP_SHELL = ["/patient/", "/patient/manifest.webmanifest", "/patient/icons/patient-app.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("h-evans-patient-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Never cache API responses or patient-specific data.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate" && url.pathname === "/patient/") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put("/patient/", response.clone()));
      return response;
    }).catch(() => caches.match("/patient/")));
    return;
  }
  if (APP_SHELL.includes(url.pathname)) event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});

// Patient push events will be wired to authenticated patient subscriptions in a later phase.
// Keep payloads generic; never put appointment or medical details on a lock screen.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title || "H Evans Optometrist", {
    body: data.body || "You have an update. Open the app to view it.",
    icon: "/patient/icons/patient-app.svg",
    badge: "/patient/icons/patient-app.svg",
    data: { url: "/patient/" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL("/patient/", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(target)) { await client.focus(); return; }
    }
    await self.clients.openWindow(target);
  })());
});
