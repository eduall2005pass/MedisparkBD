/* MediSpark PWA + push service worker (single root-scope worker).
   - PWA: cache-first for versioned static assets only (never API/exam pages).
   - Push: Firebase Cloud Messaging background handler + tap-to-open. */

const PWA_CACHE = "medispark-pwa-v3";

/* ---------- Firebase (compat builds for classic workers) ---------- */
try {
  importScripts(
    "https://www.gstatic.com/firebasejs/12.17.1/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/12.17.1/firebase-messaging-compat.js",
  );
  firebase.initializeApp({
    apiKey: "AIzaSyCmDXN01lk15m7ZDGTTyUN7D9YFljMPX8I",
    authDomain: "medisparkgo.firebaseapp.com",
    projectId: "medisparkgo",
    storageBucket: "medisparkgo.firebasestorage.app",
    messagingSenderId: "971205669963",
    appId: "1:971205669963:web:fa88bf03ecf56b496a89ce",
  });
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title =
      (payload.notification && payload.notification.title) || "MediSpark";
    const body =
      (payload.notification && payload.notification.body) ||
      "You have a new notification.";
    const url =
      (payload.data && payload.data.url) || "/dashboard/notifications";
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192-v2.png",
      badge: "/icons/icon-192-v2.png",
      data: { url },
    });
  });
} catch {
  // Push unavailable (e.g. gstatic blocked) — PWA caching still works.
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) ||
    "/dashboard/notifications";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});

/* ---------- PWA asset cache (static only, never app data) ---------- */
function isCacheable(request) {
  if (request.method !== "GET") return false;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.origin !== self.location.origin) return false;
  // Versioned Next.js bundles, fonts, public images/icons only.
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/assets/") ||
    /\.(png|jpe?g|webp|avif|svg|ico|woff2?)$/i.test(url.pathname)
  );
}

self.addEventListener("install", (event) => {
  // Activate immediately so installability + updates apply fast.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== PWA_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Navigations + API + everything else: straight to network, never cached
  // (exam integrity: no stale papers, results or auth responses, ever).
  if (request.mode === "navigate" || !isCacheable(request)) return;
  event.respondWith(
    caches.open(PWA_CACHE).then((cache) =>
      cache.match(request).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        });
      }),
    ),
  );
});
