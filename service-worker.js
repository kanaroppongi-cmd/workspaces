/* 完食帖 Service Worker — オフライン対応 */
const CACHE = "kanshoku-cache-v1";

// 事前キャッシュ(model.onnx が未配置でも他は動くよう個別にaddする)
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./model.onnx",
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(PRECACHE.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// キャッシュ優先。無ければネットから取得し、成功したら以後のためにキャッシュ。
// これにより ort の .wasm ファイル等も初回アクセス時に自動でオフライン化される。
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res && res.ok && (res.type === "basic" || res.type === "cors")) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
