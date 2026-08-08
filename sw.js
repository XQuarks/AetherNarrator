// ============================================================
// AetherNarrator · sw.js（Service Worker）
// 作用：缓存 app shell + 大体积静态资源（models/ 23MB 模型、ort-wasm 9MB、
//       vendor、src 等），让手机「二次及以后访问」秒进，不再重复下载约 33MB。
// 策略：
//   - 导航请求（HTML）：network-first，保证部署后总能拿到最新页面；
//   - 同源 GET 静态资源：cache-first（stale-while-revalidate），
//     首访下载并缓存、回访直接命中本地，含大体积模型。
// 失效：每次部署请把下方 CACHE 版本号 +1，旧缓存会在 activate 时清理。
// ============================================================
const CACHE = "aether-v1";
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./sw.js"
];

self.addEventListener("install", (event) => {
  // 跳过等待，立即激活新版本（避免用户卡在旧版）
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // 只处理同源 GET（不缓存跨域 API、不处理 POST 等）
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 导航（HTML）：network-first，失败回退缓存
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  // 其他同源静态资源：cache-first，未命中再网络并写回（stale-while-revalidate）
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
