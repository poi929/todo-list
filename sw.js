// Todo Calendar Board Service Worker
// 方針：
// - 画面（HTML）はネットワーク優先。ブラウザのHTTPキャッシュを使わず（no-store）最新を取りに行き、
//   オフラインや応答が遅い時だけ保存済みのHTMLを返す。これで古いHTMLが出続けない。
// - アイコンやマニフェストは保存済みを先に返し、裏で更新する。
// - 版ごとにキャッシュ名を変え、有効化の時に同じアプリの古いキャッシュだけを削除する
//   （github.io の同じアカウントの別アプリのキャッシュには触れない）。
const VERSION = "v105";
const CACHE_PREFIX = "todo-calendar-board-";
const CACHE_NAME = CACHE_PREFIX + VERSION;
const HTML_URL = new URL("./index.html", self.registration.scope).href;
const CORE_ASSETS = ["./index.html", "./manifest.webmanifest"];
const OPTIONAL_ASSETS = ["./icon-192.png", "./icon-512.png"];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const path of CORE_ASSETS) {
      const url = new URL(path, self.registration.scope).href;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("取得に失敗しました: " + path);
      await cache.put(url, response);
    }
    // アイコンは無くてもインストールを失敗させない。
    await Promise.all(OPTIONAL_ASSETS.map(async path => {
      try {
        const url = new URL(path, self.registration.scope).href;
        const response = await fetch(url, { cache: "no-store" });
        if (response.ok) await cache.put(url, response);
      } catch {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isHtmlRequest(request, url) {
  if (request.mode === "navigate") return true;
  const scope = new URL(self.registration.scope);
  return url.origin === scope.origin && (url.pathname === scope.pathname || url.pathname === scope.pathname + "index.html");
}

async function htmlNetworkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const network = fetch(HTML_URL, { cache: "no-store" }).then(async response => {
    if (response.ok) await cache.put(HTML_URL, response.clone());
    return response;
  });
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  try {
    const first = await Promise.race([network, timeout]);
    if (first && first.ok) return first;
  } catch {}
  const cached = await cache.match(HTML_URL);
  if (cached) return cached;
  // 保存済みが無い時は、遅くてもネットワークの結果を待つ。
  return network;
}

async function assetCacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  const update = fetch(request, { cache: "no-store" }).then(async response => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  if (cached) return cached;
  const fresh = await update;
  return fresh || new Response("", { status: 504, statusText: "offline" });
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/sw.js")) return;
  if (isHtmlRequest(request, url)) {
    event.respondWith(htmlNetworkFirst(request));
    return;
  }
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  event.respondWith(assetCacheFirst(request));
});
