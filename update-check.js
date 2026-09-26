// 新しい版が出ていないかを確かめて、出ていたら「更新する」ボタンを出す。
// ホーム画面に追加したアプリには再読み込みボタンがないので、そのかわり。
// 使い方：このファイルを読み込む前に window.UPDATE_CHECK_FILES に見張るファイルを入れておく。
(function () {
  var files = window.UPDATE_CHECK_FILES || [];
  var base = null, shown = false, busy = false, last = 0;

  function snapshot() {
    return Promise.all(files.map(function (f) {
      return fetch(f, { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.text();
      });
    })).then(function (parts) { return parts.join("\u0000"); });
  }

  function showBanner() {
    if (shown) return;
    shown = true;
    var bar = document.createElement("div");
    bar.setAttribute("role", "status");
    bar.style.cssText = "position:fixed;left:12px;right:12px;top:12px;z-index:2000;background:#1f2937;color:#fff;" +
      "border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);" +
      "font-size:.9rem;max-width:560px;margin:0 auto";
    bar.innerHTML = '<span style="flex:1">🆕 新しいバージョンがあります</span>' +
      '<button type="button" style="background:#3b82f6;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:.9rem;font-weight:bold;cursor:pointer">更新する</button>';
    bar.querySelector("button").onclick = function () { location.reload(); };
    document.body.appendChild(bar);
  }

  function check() {
    if (busy || shown || !files.length || !navigator.onLine) return;
    if (base !== null && Date.now() - last < 60 * 1000) return; // 確かめるのは1分に1回まで
    busy = true; last = Date.now();
    snapshot().then(function (now) {
      if (base === null) base = now;
      else if (now !== base) showBanner();
    }).catch(function () { /* 電波がないときなどは次の機会に */ })
      .then(function () { busy = false; });
  }

  window.addEventListener("load", function () { setTimeout(check, 3000); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") check(); });
  window.addEventListener("focus", check);
  setInterval(check, 15 * 60 * 1000);
})();
