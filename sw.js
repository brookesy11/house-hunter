/* House Hunter service worker: network first for everything (data files included) so updates show on next open; cache is the offline fallback. */
var CACHE = "house-hunter-v13b";
var ASSETS = ["./", "index.html", "styles.css", "app.js", "manifest.json",
  "apple-touch-icon.png?v=6", "icons/icon-180.png?v=6", "icons/icon-192.png?v=6", "icons/icon-512.png?v=6", "icons/icon-maskable-512.png?v=6", "icons/favicon.ico?v=6"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(ASSETS.map(function (a) {
      return fetch(new Request(a, { cache: "reload" })).then(function (r) { if (r.ok) return c.put(a, r); });
    }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  /* Never intercept or cache cross-origin requests (Zillow photos, map tiles): the browser handles them directly. */
  if (url.origin !== self.location.origin) return;
  var isData = url.pathname.indexOf("/data/") !== -1;
  e.respondWith(
    fetch(e.request, { cache: isData ? "no-store" : "no-cache" }).then(function (res) {
      if (res && res.status === 200 && res.type === "basic") {
        var copy = res.clone(); var key = isData ? url.origin + url.pathname : e.request;
        caches.open(CACHE).then(function (c) { c.put(key, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(isData ? url.origin + url.pathname : e.request, { ignoreSearch: true }).then(function (hit) {
        return hit || (e.request.mode === "navigate" ? caches.match("index.html") : undefined);
      });
    })
  );
});
