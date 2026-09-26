// Firebase とのやりとり（ログイン・データの保存と読み込み）を担当するファイル。
// 画面側（index.html）とは次のものでつながっている：
//   window.cloudSave(state, {stale}) … 画面側が「保存して」と頼む（送った文書の数を返す）
//   window.onCloudData(state)        … こちらから「最新データが届いた」と知らせる
//   window.cloudMarkApplied(state)   … 画面側が「届いたデータを画面に反映した」と知らせる
//   window.cloudSyncPortals()        … スタッフ用ページの内容を、今の画面のデータに合わせる
//   window.cloudLogout()             … ログアウト
//
// 保存の形（Firestore）：
//   appData/staff        … { staffList }
//   months/{年-月}       … { wishes, shifts, operating, periodRules, published, wishSync } のうち、その月の分
//   portals/{合言葉}     … スタッフ用ページに見せる本人の分だけの情報（管理者が書き出す）
//   submissions/{合言葉_年-月} … スタッフが専用リンクから出した希望（管理者の画面が取り込む）
// 月ごとに分けているのは、1つの入れ物の大きさ上限（約1MB）に年々近づかないようにするため。
//
// 保存は「自分が変えた項目だけ」を送る。変えたかどうかは、画面が最後に反映したクラウドの状態（base）と比べて決める。
// こうすると、他の端末の変更がまだ画面に届いていない間（小窓を開いている間など）に保存しても、
// 自分が触っていない項目を古い内容で上書きしたり、他の端末が作った月を消したりしない。
// また、項目ごとに送るので、この版が知らない項目（将来の版が足したもの）も消さずに残る。

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, onSnapshot, writeBatch, deleteField
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// 中身が同じかどうかを比べるための文字列化。Firebase は項目の並び順を変えて返すことがあるので、
// 並び順をそろえてから比べる（そろえないと、同じ内容を何度も保存し直してしまう）
const stable = v => JSON.stringify(v, (k, x) =>
  x && typeof x === "object" && !Array.isArray(x)
    ? Object.keys(x).sort().reduce((o, key) => (o[key] = x[key], o), {})
    : x);

const MONTH_FIELDS = ["wishes", "shifts", "operating", "periodRules", "published", "wishSync"];

const $ = id => document.getElementById(id);
const loginScreen = $("login-screen"), loginForm = $("login-form"), loginLead = $("login-lead");
const loginFields = $("login-fields"), loginError = $("login-error"), loginBtn = $("login-btn");
const syncEl = $("sync-status");

function setSync(text, level) {
  syncEl.textContent = text;
  syncEl.className = "sync-status" + (level ? " " + level : "");
}

if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("ここに")) {
  loginLead.textContent = "Firebase の設定（firebase-config.js）がまだ入っていません。";
  throw new Error("firebase-config.js が未設定です");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// 端末の中にも控えを持っておく設定。電波が切れても表示・編集でき、つながったら自動で送られる。
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const staffRef = doc(db, "appData", "staff");
const monthsCol = collection(db, "months");
const portalsCol = collection(db, "portals");
const submissionsCol = collection(db, "submissions");

// ---- ログイン ----
loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  loginError.textContent = "";
  loginBtn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $("login-email").value.trim(), $("login-password").value);
    $("login-password").value = "";
  } catch (err) {
    const code = err && err.code || "";
    loginError.textContent =
      code === "auth/network-request-failed" ? "インターネットにつながっていません。" :
      code === "auth/too-many-requests" ? "失敗が続いたため一時的にロックされています。しばらく待ってください。" :
      "メールアドレスかパスワードが違います。";
  } finally {
    loginBtn.disabled = false;
  }
});

window.cloudLogout = async () => {
  if (!confirm("ログアウトしますか？")) return;
  await signOut(auth);
  location.reload();
};

// ---- 読み込み（他の端末の変更もここに届く）----
let unsubs = [];
let staffData = null;          // appData/staff の中身（届くまで null）
let monthsData = null;         // { "2026-10": {...}, ... }（届くまで null）
let submissions = null;        // スタッフから届いた希望の一覧（届くまで null）
let portalsKnown = null;       // 今クラウドにあるスタッフ用ページの合言葉 → 中身(比較用の文字列)
let baseState = null;          // 画面が最後に反映したクラウドの状態（自分が何を変えたかを見分けるのに使う）
let firstPublished = false;

window.cloudMarkApplied = st => { baseState = JSON.parse(JSON.stringify(st)); };

function publish() {
  if (staffData === null || monthsData === null) return;
  const state = { staffList: staffData.staffList || [] };
  for (const f of MONTH_FIELDS) state[f] = {};
  for (const [ym, m] of Object.entries(monthsData)) {
    for (const f of MONTH_FIELDS) if (m[f] !== undefined) state[f][ym] = m[f];
  }
  window.onCloudData(state);
  applySubmissions();
}

// スタッフが出した希望を画面側に渡して取り込んでもらう
function applySubmissions() {
  if (staffData === null || monthsData === null || submissions === null || portalsKnown === null) return;
  if (!firstPublished) {
    firstPublished = true;
    window.saveState(); // 起動時に一度、スタッフ用ページの内容（対象の月など）を最新にしておく
  }
  if (window.applyWishSubmissions(submissions)) {
    window.saveState();
    window.refreshAll();
  }
}

function onReadError(err) {
  console.error(err);
  setSync("⚠️ 読み込みエラー", "error");
  alert("データを読み込めませんでした。\n" + (err.code === "permission-denied"
    ? "このアカウントには使う権限がありません。" : err.message));
}

onAuthStateChanged(auth, user => {
  unsubs.forEach(u => u()); unsubs = [];
  if (!user) {
    loginLead.textContent = "スタッフ共通のメールアドレスとパスワードを入力してください。";
    loginFields.classList.remove("hidden");
    loginScreen.classList.remove("hidden");
    return;
  }
  loginScreen.classList.add("hidden");
  setSync("読み込み中...");
  unsubs.push(onSnapshot(staffRef, { includeMetadataChanges: true }, snap => {
    staffData = snap.exists() ? snap.data() : {};
    updateSyncFromMeta(snap.metadata);
    publish();
  }, onReadError));
  unsubs.push(onSnapshot(monthsCol, { includeMetadataChanges: true }, snap => {
    monthsData = {};
    snap.forEach(d => { monthsData[d.id] = d.data(); });
    updateSyncFromMeta(snap.metadata);
    publish();
  }, onReadError));
  unsubs.push(onSnapshot(portalsCol, snap => {
    portalsKnown = new Map();
    snap.forEach(d => portalsKnown.set(d.id, stable(d.data())));
    applySubmissions();
  }, onReadError));
  unsubs.push(onSnapshot(submissionsCol, snap => {
    submissions = [];
    snap.forEach(d => {
      const v = d.data();
      if (v.updatedAt) submissions.push({ token: v.token, ym: v.ym, days: v.days, at: v.updatedAt.toMillis() });
    });
    applySubmissions();
  }, onReadError));
});

// ---- 保存 ----
let pending = 0;

function updateSyncFromMeta(meta) {
  if (pending > 0 || meta.hasPendingWrites) {
    setSync(navigator.onLine ? "保存中..." : "📴 オフライン（つながったら保存）", "warn");
  } else if (meta.fromCache && !navigator.onLine) {
    setSync("📴 オフライン", "warn");
  } else {
    setSync("☁️ 保存済み");
  }
}
window.addEventListener("online", () => setSync(pending ? "保存中..." : "☁️ 保存済み", pending ? "warn" : ""));
window.addEventListener("offline", () => setSync("📴 オフライン（つながったら保存）", "warn"));

// 画面のデータを、文書ごとの「この版が扱う項目」に分ける
function fieldsOf(st) {
  const out = new Map();
  if (!st) return out;
  out.set("staff", { staffList: st.staffList || [] });
  for (const f of MONTH_FIELDS) {
    for (const [ym, v] of Object.entries(st[f] || {})) {
      if (v === undefined) continue;
      const key = "month:" + ym;
      if (!out.has(key)) out.set(key, {});
      out.get(key)[f] = v;
    }
  }
  return out;
}
const fieldsOfKey = key => key === "staff" ? ["staffList"] : MONTH_FIELDS;
const refOf = key => key === "staff" ? staffRef : doc(monthsCol, key.slice(6));
const remoteOf = key => (key === "staff" ? staffData : monthsData[key.slice(6)]) || {};
const jsonOf = (obj, f) => f in obj ? stable(obj[f]) : undefined;

// スタッフ用ページ（本人の分だけ）を、今の画面のデータに合わせる。送った数を返す
function syncPortals(batch) {
  if (portalsKnown === null) return 0;
  const views = window.buildPortalViews();
  let n = 0;
  for (const [token, view] of Object.entries(views)) {
    const json = stable(view);
    if (portalsKnown.get(token) !== json) {
      batch.set(doc(portalsCol, token), view); portalsKnown.set(token, json); n++;
    }
  }
  // 今のデータにない合言葉（無効にした・作り直した・スタッフを消した）はクラウドからも消す
  for (const token of [...portalsKnown.keys()]) {
    if (!(token in views)) { batch.delete(doc(portalsCol, token)); portalsKnown.delete(token); n++; }
  }
  return n;
}

function commit(batch) {
  pending++;
  setSync(navigator.onLine ? "保存中..." : "📴 オフライン（つながったら保存）", "warn");
  batch.commit().then(() => {
    pending--;
    if (!pending) setSync("☁️ 保存済み");
  }).catch(err => {
    pending--;
    console.error(err);
    setSync("⚠️ 保存に失敗", "error");
    alert("保存に失敗しました。もう一度操作するか、画面を読み込み直してください。\n" + err.message);
  });
}

window.cloudSave = (state, opts = {}) => {
  if (!auth.currentUser || staffData === null || monthsData === null) return 0;
  // JSON を通すと、Firestore が受け付けない undefined などが取り除かれる
  const clean = JSON.parse(JSON.stringify(state));
  const local = fieldsOf(clean), base = fieldsOf(baseState);
  const batch = writeBatch(db);
  let written = 0;

  for (const key of new Set([...local.keys(), ...base.keys()])) {
    const L = local.get(key) || {}, B = base.get(key) || {}, R = remoteOf(key);
    const data = {}, del = [];
    for (const f of fieldsOfKey(key)) {
      const lj = jsonOf(L, f);
      if (lj === jsonOf(R, f)) continue;                   // もうクラウドと同じ
      if (baseState && lj === jsonOf(B, f)) continue;      // 自分は変えていない（クラウドの方が新しい）
      if (lj === undefined) del.push(f); else data[f] = L[f];
    }
    if (!Object.keys(data).length && !del.length) continue;

    const rest = Object.keys(R).filter(k => !(k in data) && !del.includes(k));
    if (!Object.keys(data).length && !rest.length) {
      batch.delete(refOf(key));                            // 何も残らないなら文書ごと消す
      if (key !== "staff") delete monthsData[key.slice(6)];
    } else {
      const payload = { ...data };
      for (const f of del) payload[f] = deleteField();
      batch.set(refOf(key), payload, { mergeFields: Object.keys(payload) });
      // 返事が届くまでの間に同じ内容を二度送らないよう、手元の「クラウドの状態」も先に進めておく
      const next = { ...R, ...JSON.parse(JSON.stringify(data)) };
      for (const f of del) delete next[f];
      if (key === "staff") staffData = next; else monthsData[key.slice(6)] = next;
    }
    written++;
  }
  // 画面がまだ古いとき（小窓を開いている間など）は、スタッフ用ページは画面が最新になってから合わせる
  const portals = opts.stale ? 0 : syncPortals(batch);
  baseState = clean;
  if (written || portals) commit(batch);
  return written;
};

window.cloudSyncPortals = () => {
  if (!auth.currentUser || staffData === null || monthsData === null) return;
  const batch = writeBatch(db);
  if (syncPortals(batch)) commit(batch);
};
