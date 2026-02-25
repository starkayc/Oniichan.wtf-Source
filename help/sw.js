// Service Worker for offline support and caching
// Version: 2.1.0

const CACHE_NAME = "oniichan-wtf-v2.1.0";
const urlsToCache = [
  "/help/",
  "/help/index.html",
  "/help/skins.html",
  "/help/songs.html",
  "/help/assets/css/font-awesome-7.1.0-all.min.css",
  "/help/assets/css/video-js-8.10.0.css",
  "/help/assets/css/global-styles.css",
  "/help/assets/css/design-modern.css",
  "/help/assets/fonts/ibm-plex-sans.css",
  "/help/assets/fonts/fa-brands-400.woff2",
  "/help/assets/fonts/fa-solid-900.woff2",
  "/help/assets/js/tailwindcss-3.4.17.js",
  "/help/assets/js/video-8.10.0.min.js",
  "/help/assets/js/navigation.js",
  "/help/assets/images/favicon.png",
  "/help/assets/images/favicon.ico",
];

// Install event - cache resources
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
      .catch((err) => {
        console.error("Cache installation failed:", err);
      })
  );
  self.skipWaiting();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Cache hit - return response
      if (response) {
        return response;
      }

      // Clone the request
      const fetchRequest = event.request.clone();

      return fetch(fetchRequest)
        .then((response) => {
          // Check if valid response
          if (!response || response.status !== 200 || response.type !== "basic") {
            return response;
          }

          // Clone the response
          const responseToCache = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return response;
        })
        .catch((err) => {
          console.error("Fetch failed:", err);
          // Return offline page or cached fallback if available
          return caches.match("/help/index.html");
        });
    })
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  const cacheWhitelist = [CACHE_NAME];

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!cacheWhitelist.includes(cacheName)) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );

  self.clients.claim();
});

// Handle messages from clients
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
