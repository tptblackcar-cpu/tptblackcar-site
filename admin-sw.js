// TPT Desk service worker. It only looks after the app's own files, so the
// desk opens instantly and still opens with no signal. Reservations always come
// live from Apps Script: those requests go to another origin and pass straight
// through, and nothing about a rider is ever stored here.

// Each ?v= here must match admin.html exactly, or the desk will not open offline.
// Bump CACHE whenever they change.
const CACHE = "tpt-desk-v10";
const SHELL = [
  "/admin.html",
  "/desk.css?v=6",
  "/desk.js?v=10",
  "/tokens.css?v=13",
  "/config.js?v=2",
  "/assets/mark.svg",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/tab-portrait.webp",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tpt-desk-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first, so a new version reaches Tab the next time she opens the app;
// the cache is only the fallback for a dead zone. One bar of signal can leave a
// request hanging for a minute, so after a few seconds the saved copy is used.
const NETWORK_WAIT = 4000;
const withTimeout = (p) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("slow network")), NETWORK_WAIT);
  p.then((v) => { clearTimeout(timer); resolve(v); }, (err) => { clearTimeout(timer); reject(err); });
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    withTimeout(fetch(req))
      .then((res) => {
        if (res.ok && SHELL.includes(url.pathname + url.search)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" })
        .then((hit) => hit || (req.mode === "navigate" ? caches.match("/admin.html") : Response.error())))
  );
});
