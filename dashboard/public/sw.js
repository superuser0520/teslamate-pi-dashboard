const cacheName = "soolew-dashboard-v6";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll([
    "/",
    "/styles.css",
    "/app.js",
    "/manifest.webmanifest",
    "/assets/cars/model3-white-dark.png",
    "/assets/cars/model3-white-light.png",
    "/assets/icons/home.png",
    "/assets/icons/car.png",
    "/assets/icons/charging.png",
    "/assets/icons/battery.png",
    "/assets/icons/more.png",
    "/assets/icons/bell.png",
    "/assets/icons/settings.png",
    "/assets/icons/wallet.png",
    "/assets/icons/bars.png",
    "/assets/icons/pulse.png",
    "/assets/icons/check.png"
  ])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.url.includes("/api/")) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
