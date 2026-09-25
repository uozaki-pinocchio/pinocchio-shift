// スタッフ用ページ（専用リンク wish.html?k=合言葉 で開く）。
// ログインなしで、本人の出勤希望の提出と、公開されたシフト（本人の分）の確認だけができる。
//   読むもの： portals/{合言葉}            … 管理者の画面が書き出した本人用の情報
//             submissions/{合言葉_年-月}   … 自分が前に出した希望
//   書くもの： submissions/{合言葉_年-月}

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getFirestore, doc, onSnapshot, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = id => document.getElementById(id);
const DAYS_JP = ["日", "月", "火", "水", "木", "金", "土"];
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const parseDate = s => new Date(s + "T00:00:00");
const p2 = n => String(n).padStart(2, "0");
const fmtDay = d => { const t = parseDate(d); return `${t.getMonth() + 1}/${t.getDate()}`; };
const wdayCls = d => { const w = parseDate(d).getDay(); return w === 0 ? "sun" : w === 6 ? "sat" : ""; };

const token = new URLSearchParams(location.search).get("k") || "";
const main = $("main");

let view = null;                // 本人用の情報

function fatal(msg) {
  view = null; // 以降に届く知らせで元の画面に戻らないように
  $("who").textContent = "";
  $("tabs").classList.add("hidden");
  $("bar").classList.add("hidden");
  main.innerHTML = `<p class="center">${msg}</p>`;
}

if (!/^[0-9a-f]{32}$/.test(token)) {
  fatal("このリンクは使えません。<br>管理者から届いたリンクを、そのまま開いてください。");
  throw new Error("bad token");
}

const db = getFirestore(initializeApp(firebaseConfig));

const mine = {};                // ym → { days, at }（自分が前に出した希望）
const drafts = {};              // ym → { 日付: 時刻 | "off" }（まだ提出していない変更）
const sending = {};             // ym → true（送信中）
let tab = "wish", curYM = null;
const subUnsubs = {};

// 今日がどの「月分」か（21日〜翌20日で1か月）
function ymOfToday() {
  const t = new Date();
  const d = t.getDate() >= 21 ? new Date(t.getFullYear(), t.getMonth() + 1, 1) : t;
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
}

onSnapshot(doc(db, "portals", token), snap => {
  if (!snap.exists()) {
    fatal("このリンクは使えなくなっています。<br>管理者に新しいリンクをもらってください。");
    return;
  }
  view = snap.data();
  $("who").textContent = `${view.name} さん`;
  $("tabs").classList.remove("hidden");
  for (const m of view.months) {
    if (subUnsubs[m.ym]) continue;
    subUnsubs[m.ym] = onSnapshot(doc(db, "submissions", `${token}_${m.ym}`), s => {
      // 送信直後は時刻がまだ決まっていないので、見込みの時刻を使う
      const v = s.exists() ? s.data({ serverTimestamps: "estimate" }) : null;
      if (v && v.updatedAt) mine[m.ym] = { days: v.days || {}, at: v.updatedAt.toMillis() };
      render();
    }, () => {});
  }
  render();
}, err => {
  console.error(err);
  fatal(navigator.onLine ? "読み込めませんでした。時間をおいて開き直してください。" : "インターネットにつながっていません。");
});

$("tab-wish").onclick = () => { tab = "wish"; curYM = null; render(); };
$("tab-shift").onclick = () => { tab = "shift"; curYM = null; render(); };
$("submit-btn").onclick = submit;
window.addEventListener("beforeunload", e => { if (Object.keys(drafts).length) { e.preventDefault(); e.returnValue = ""; } });

function monthsFor(t) {
  const today = ymOfToday();
  // 希望：今月分から先 ／ シフト：公開されている月
  return t === "wish" ? view.months.filter(m => m.ym >= today) : view.months.filter(m => m.shift);
}

// 今の希望（未提出の変更 → 自分が出したもの → 管理者の画面にあるもの の順で新しいほう）
function currentWishes(m) {
  if (drafts[m.ym]) return drafts[m.ym];
  const s = mine[m.ym];
  return s && s.at > (m.wishAt || 0) ? s.days : m.wishes || {};
}

function render() {
  if (!view) return;
  $("tab-wish").classList.toggle("active", tab === "wish");
  $("tab-shift").classList.toggle("active", tab === "shift");
  const list = monthsFor(tab);
  if (!list.find(m => m.ym === curYM)) {
    const today = ymOfToday();
    const next = list.find(m => m.ym > today);
    curYM = (tab === "wish" ? (next || list[0]) : (list.find(m => m.ym === today) || list[list.length - 1]))?.ym || null;
  }
  const chips = `<div class="months">${list.map(m =>
    `<button data-ym="${m.ym}" class="${m.ym === curYM ? "active" : ""}">${esc(m.label)}${drafts[m.ym] ? " ●" : ""}</button>`).join("")}</div>`;
  const m = list.find(x => x.ym === curYM);

  if (tab === "shift") {
    $("bar").classList.add("hidden");
    if (!m) { main.innerHTML = `<p class="center">まだ公開されているシフトはありません。<br>公開されたら、ここに出勤日が表示されます。</p>`; return; }
    const days = m.days.filter(d => m.shift[d.d]);
    main.innerHTML = chips + `<p class="range">${esc(m.range)}</p>
      <p class="count">出勤 <b>${days.length}</b> 日</p>
      <div class="days shift-list">${days.length ? days.map(d => `
        <div class="day"><span class="date ${wdayCls(d.d)}">${fmtDay(d.d)}<small>（${DAYS_JP[parseDate(d.d).getDay()]}）</small></span>
          <span class="info">${d.st === "event" ? "🎪 " + esc(d.ev) : ""}</span>
          <span class="val">${m.shift[d.d].time}〜${m.shift[d.d].end}</span></div>`).join("")
        : `<p class="center">この月の出勤日はありません。</p>`}</div>`;
  } else {
    if (!m) { main.innerHTML = `<p class="center">いま希望を出せる月がありません。</p>`; $("bar").classList.add("hidden"); return; }
    const w = currentWishes(m);
    const submitted = mine[m.ym];
    main.innerHTML = chips + `<p class="range">${esc(m.range)}</p>
      <div class="note">日付をタップして、出勤できる時刻か「休み」を選んでください。<br>選び終わったら、下の <b>「提出する」</b> を押してください。あとから何度でも変更できます。</div>
      ${m.shift ? `<div class="note warn">この月のシフトはもう公開されています。希望を変えたときは、念のため管理者にも一声かけてください。</div>` : ""}
      <div class="days">${m.days.map(d => {
        const v = w[d.d], wd = DAYS_JP[parseDate(d.d).getDay()];
        const date = `<span class="date ${wdayCls(d.d)}">${fmtDay(d.d)}<small>（${wd}）</small></span>`;
        if (d.st === "closed") return `<div class="day closed">${date}<span class="info"></span><span class="val">休館</span></div>`;
        const label = v === "off" ? "休み" : v ? `${v}〜${d.st === "event" ? d.end : view.end}` : "未入力";
        return `<div class="day tap" data-d="${d.d}">${date}
          <span class="info">${d.st === "event" ? `🎪 ${esc(d.ev)}（${d.start}〜${d.end}）` : ""}</span>
          <span class="val ${v === "off" ? "off" : v ? "work" : ""}">${label}</span></div>`;
      }).join("")}</div>`;
    main.querySelectorAll(".day.tap").forEach(el => el.onclick = () => openSheet(m, el.dataset.d));
    $("bar").classList.remove("hidden");
    const st = $("bar-status");
    if (sending[m.ym]) { st.textContent = navigator.onLine ? "送信中..." : "電波が戻ったら送信します（このページは開いたままに）"; st.className = "status dirty"; }
    else if (drafts[m.ym]) { st.textContent = "まだ提出していない変更があります"; st.className = "status dirty"; }
    else if (submitted) { const t = new Date(submitted.at); st.textContent = `✅ 提出済み（${t.getMonth() + 1}/${t.getDate()} ${p2(t.getHours())}:${p2(t.getMinutes())}）`; st.className = "status"; }
    else { st.textContent = "まだ提出していません"; st.className = "status"; }
    $("submit-btn").disabled = !drafts[m.ym] || !!sending[m.ym];
  }
  main.querySelectorAll(".months button").forEach(b => b.onclick = () => { curYM = b.dataset.ym; render(); });
}

function openSheet(m, d) {
  const info = m.days.find(x => x.d === d);
  const cur = currentWishes(m)[d];
  const opts = info.st === "event"
    ? [{ v: info.start, label: `🎪 ${info.start}〜${info.end}（${esc(info.ev)}）` }]
    : view.times.map(t => ({ v: t, label: `${t}〜${view.end}` }));
  const root = $("sheet-root");
  root.innerHTML = `<div class="sheet-bg"><div class="sheet">
    <h2>${fmtDay(d)}（${DAYS_JP[parseDate(d).getDay()]}）</h2>
    ${opts.map(o => `<button data-v="${o.v}" class="${cur === o.v ? "sel" : ""}">${o.label}</button>`).join("")}
    <button data-v="off" class="offb ${cur === "off" ? "sel" : ""}">❌ 休み（出勤できない）</button>
    <button data-v="">（未入力に戻す）</button>
    <button class="cancel" data-cancel="1">キャンセル</button></div></div>`;
  const close = () => { root.innerHTML = ""; };
  root.querySelector(".sheet-bg").onclick = e => { if (e.target.classList.contains("sheet-bg")) close(); };
  root.querySelectorAll(".sheet button").forEach(b => b.onclick = () => {
    if (b.dataset.cancel) return close();
    const next = { ...currentWishes(m) };
    if (b.dataset.v) next[d] = b.dataset.v; else delete next[d];
    drafts[m.ym] = next;
    close(); render();
  });
}

function submit() {
  const ym = curYM, days = drafts[ym];
  if (!days) return;
  sending[ym] = true; render();
  setDoc(doc(db, "submissions", `${token}_${ym}`), { token, ym, days, updatedAt: serverTimestamp() })
    .then(() => {
      delete sending[ym];
      if (drafts[ym] === days) delete drafts[ym];
      render();
      alert("提出しました。ありがとうございます！");
    })
    .catch(err => {
      console.error(err);
      delete sending[ym]; render();
      alert(err.code === "permission-denied"
        ? "このリンクは使えなくなっています。管理者に新しいリンクをもらってください。"
        : "提出できませんでした。もう一度「提出する」を押してください。");
    });
}
window.addEventListener("online", render);
window.addEventListener("offline", render);
