// アプリの「控え係」。一度開いた画面の部品を端末にしまっておき、
// 電波がないときはそれを使って開けるようにする。
// つながっているときは毎回まず最新版を取りに行くので、アプリを直せばすぐ反映される。
// （シフトのデータそのものは Firebase が別に端末へ控えているので、ここでは扱わない）

const CACHE = "pinocchio-shift-v2";
const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/";
const PRECACHE = [
  "./", "./index.html", "./cloud.js", "./firebase-config.js", "./manifest.json",
  "./wish.html", "./wish.js",
  "./icons/icon-192.png", "./icons/apple-touch-icon.png", "./icons/favicon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // このアプリのファイルと Firebase の部品だけを控える（データのやりとりには触らない）
  if (url.origin !== location.origin && !req.url.startsWith(FIREBASE_SDK)) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then(hit =>
          hit || (req.mode === "navigate"
            ? caches.match(url.pathname.endsWith("wish.html") ? "./wish.html" : "./index.html")
            : Response.error())
        )
      )
  );
});
