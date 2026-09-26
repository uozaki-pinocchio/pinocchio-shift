// アプリの「控え係」。一度開いた画面の部品を端末にしまっておき、
// 電波がないときはそれを使って開けるようにする。
// つながっているときは毎回まず最新版を取りに行くので、アプリを直せばすぐ反映される。
// （GitHub Pages は「10分は使い回してよい」という印を付けて渡してくるので、
//   このアプリのファイルは毎回「変わっていないか」を確認させて、古い版をつかまないようにしている）
// （シフトのデータそのものは Firebase が別に端末へ控えているので、ここでは扱わない）

const CACHE = "pinocchio-shift-v4";
const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/";
const PRECACHE = [
  "./", "./index.html", "./cloud.js", "./firebase-config.js", "./manifest.json",
  "./wish.html", "./wish.js", "./update-check.js",
  "./icons/icon-192.png", "./icons/apple-touch-icon.png", "./icons/favicon.png"
];

self.addEventListener("install", event => {
  // 控えを作るときも、ブラウザの「10分使い回し」を通さずに最新版を取りに行く
  event.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
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
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && !req.url.startsWith(FIREBASE_SDK)) return;
  const key = url.origin + url.pathname; // ?k=… などは控えの名前に含めない

  event.respondWith(
    (sameOrigin ? fetch(req.url, { cache: "no-cache" }) : fetch(req))
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(key, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(key).then(hit =>
          hit || (req.mode === "navigate"
            ? caches.match(url.pathname.endsWith("wish.html") ? "./wish.html" : "./index.html")
            : Response.error())
        )
      )
  );
});
