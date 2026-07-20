self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("teslamate-dashboard-v1").then((cache) => cache.addAll(["/", "/styles.css", "/app.js", "/manifest.webmanifest"])));
});

self.addEventListener("fetch", (event) => {
  if (event.request.url.includes("/api/")) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
