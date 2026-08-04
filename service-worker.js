/* ═══════════════════════════════════════════════════════
   完食帖 — Service Worker
   役割は3つ:
     1. アプリ本体(HTML/アイコン)をオフラインで開けるようにする
     2. ONNX Runtime の js/wasm をキャッシュする
     3. モデル(約17MB)を初回だけ取得して以後は端末から読む

   アプリを更新したら CACHE_VERSION を必ず上げてください。
   上げないと古いHTMLが残り続けます。
   ═══════════════════════════════════════════════════════ */

const CACHE_VERSION = "v1";
const CORE_CACHE  = `kanshoku-core-${CACHE_VERSION}`;
const ORT_CACHE   = `kanshoku-ort-${CACHE_VERSION}`;
const MODEL_CACHE = `kanshoku-model-${CACHE_VERSION}`; // モデル差し替え時だけ上げれば十分

/* アプリ本体。install時にまとめて取得する。
   ここに存在しないファイルを書くと install ごと失敗するので注意。 */
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

/* モデル本体。単一ファイル化していれば model.onnx だけでよい。
   2ファイル構成のままなら model.onnx.data も配列に足してください。 */
const MODEL_ASSETS = [
  "./model.onnx",
  // "./model.onnx.data",
];

const isOrtAsset   = url => /cdn\.jsdelivr\.net\/npm\/onnxruntime-web/.test(url.href)
                         || /\/ort\/.*\.(js|mjs|wasm)$/.test(url.pathname);
const isModelAsset = url => /\.onnx(\.data)?$/.test(url.pathname);

/* ── インストール ───────────────────────────
   モデルはここでは取りません。17MB を初回起動時に強制ダウンロードすると
   モバイル回線で installに失敗したり、待たされたりするためです。
   モデルは実際に判定した時か、アプリから明示的に依頼された時に保存します。

   個別に add して allSettled で待つので、CORE_ASSETS に無いファイルが
   混じっていても install 自体は成功します(そのファイルだけ入りません)。 */
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then(cache => Promise.allSettled(
        CORE_ASSETS.map(url => cache.add(url).catch(e => {
          console.warn("[sw] キャッシュできませんでした:", url, e);
          throw e;
        }))
      ))
      .then(() => self.skipWaiting())
  );
});

/* ── 有効化 ─────────────────────────────
   バージョンの違う古いキャッシュを掃除する。 */
self.addEventListener("activate", event => {
  const keep = new Set([CORE_CACHE, ORT_CACHE, MODEL_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(n => n.startsWith("kanshoku-") && !keep.has(n))
             .map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── 取得戦略 ───────────────────────────── */

// キャッシュ優先。無ければ取得して保存する(モデル・ORT向け)
async function cacheFirst(request, cacheName){
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if(hit) return hit;

  const res = await fetch(request);
  // 206(部分応答)や失敗はCache APIに入れられないので素通しする
  if(res && res.status === 200){
    cache.put(request, res.clone()).catch(()=>{});
  }
  return res;
}

// ネットワーク優先。失敗したらキャッシュ(アプリ本体向け)
// 開発中にHTMLを直したのに反映されない、という事態を避けるためこちらにしています
async function networkFirst(request, cacheName){
  const cache = await caches.open(cacheName);
  try{
    const res = await fetch(request);
    if(res && res.status === 200) cache.put(request, res.clone()).catch(()=>{});
    return res;
  }catch(e){
    const hit = await cache.match(request) || await cache.match("./index.html");
    if(hit) return hit;
    throw e;
  }
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if(req.method !== "GET") return;

  const url = new URL(req.url);

  // モデル: キャッシュ優先(一度取れば以後はオフラインで動く)
  if(isModelAsset(url)){
    event.respondWith(cacheFirst(req, MODEL_CACHE));
    return;
  }

  // ONNX Runtime の js/wasm: キャッシュ優先
  if(isOrtAsset(url)){
    event.respondWith(cacheFirst(req, ORT_CACHE));
    return;
  }

  // 他ドメインのものはそのまま通す
  if(url.origin !== self.location.origin) return;

  // ページ遷移: ネットワーク優先、オフラインならキャッシュ
  if(req.mode === "navigate"){
    event.respondWith(networkFirst(req, CORE_CACHE));
    return;
  }

  // 同一オリジンの静的ファイル
  event.respondWith(networkFirst(req, CORE_CACHE));
});

/* ── アプリからの指示 ─────────────────────
   「モデルを端末に保存」ボタンなどから呼べます。
   進捗と結果を postMessage で返します。 */
self.addEventListener("message", event => {
  const msg = event.data || {};

  if(msg.type === "SKIP_WAITING"){
    self.skipWaiting();
    return;
  }

  if(msg.type === "CACHE_MODEL"){
    event.waitUntil((async () => {
      const cache = await caches.open(MODEL_CACHE);
      try{
        for(const path of MODEL_ASSETS){
          const hit = await cache.match(path);
          if(hit) continue;
          const res = await fetch(path);
          if(!res.ok) throw new Error(`${path} を取得できません (${res.status})`);
          await cache.put(path, res.clone());
        }
        reply(event, {type:"MODEL_CACHED", ok:true});
      }catch(e){
        reply(event, {type:"MODEL_CACHED", ok:false, error:String(e.message || e)});
      }
    })());
    return;
  }

  if(msg.type === "MODEL_STATUS"){
    event.waitUntil((async () => {
      const cache = await caches.open(MODEL_CACHE);
      const found = [];
      for(const path of MODEL_ASSETS){
        if(await cache.match(path)) found.push(path);
      }
      reply(event, {type:"MODEL_STATUS", cached: found.length === MODEL_ASSETS.length, found});
    })());
  }
});

function reply(event, payload){
  if(event.source) event.source.postMessage(payload);
  else self.clients.matchAll().then(cs => cs.forEach(c => c.postMessage(payload)));
}
