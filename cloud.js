// Firebase とのやりとり（ログイン・データの保存と読み込み）を担当するファイル。
// 画面側（index.html）とは次の3つだけでつながっている：
//   window.cloudSave(state)  … 画面側が「保存して」と頼む
//   window.onCloudData(state) … こちらから「最新データが届いた」と知らせる
//   window.cloudLogout()      … ログアウト
//
// 保存の形（Firestore）：
//   appData/staff        … { staffList }
//   months/{年-月}       … { wishes, shifts, operating, periodRules } のうち、その月の分
// 月ごとに分けているのは、1つの入れ物の大きさ上限（約1MB）に年々近づかないようにするため。

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig, LOGIN_EMAIL } from "./firebase-config.js";

const MONTH_FIELDS = ["wishes", "shifts", "operating", "periodRules"];

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

// ---- ログイン ----
loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  loginError.textContent = "";
  loginBtn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, LOGIN_EMAIL, $("login-password").value);
    $("login-password").value = "";
  } catch (err) {
    const code = err && err.code || "";
    loginError.textContent =
      code === "auth/network-request-failed" ? "インターネットにつながっていません。" :
      code === "auth/too-many-requests" ? "失敗が続いたため一時的にロックされています。しばらく待ってください。" :
      "パスワードが違います。";
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
const knownJSON = new Map();   // 文書ごとの「今クラウドにある中身」。変わった所だけ送るのに使う

function publish() {
  if (staffData === null || monthsData === null) return;
  const state = { staffList: staffData.staffList || [], wishes: {}, shifts: {}, operating: {}, periodRules: {} };
  for (const [ym, m] of Object.entries(monthsData)) {
    for (const f of MONTH_FIELDS) if (m[f] !== undefined) state[f][ym] = m[f];
  }
  window.onCloudData(state);
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
    loginLead.textContent = "パスワードを入力してください。";
    loginFields.classList.remove("hidden");
    loginScreen.classList.remove("hidden");
    return;
  }
  loginScreen.classList.add("hidden");
  setSync("読み込み中...");
  unsubs.push(onSnapshot(staffRef, { includeMetadataChanges: true }, snap => {
    staffData = snap.exists() ? snap.data() : {};
    knownJSON.set("staff", JSON.stringify({ staffList: staffData.staffList || [] }));
    updateSyncFromMeta(snap.metadata);
    publish();
  }, onReadError));
  unsubs.push(onSnapshot(monthsCol, { includeMetadataChanges: true }, snap => {
    monthsData = {};
    for (const [key] of knownJSON) if (key.startsWith("month:")) knownJSON.delete(key);
    snap.forEach(d => {
      monthsData[d.id] = d.data();
      knownJSON.set("month:" + d.id, JSON.stringify(pickMonth(d.data())));
    });
    updateSyncFromMeta(snap.metadata);
    publish();
  }, onReadError));
});

// ---- 保存 ----
let pending = 0;

function pickMonth(src) {
  const out = {};
  for (const f of MONTH_FIELDS) if (src[f] !== undefined) out[f] = src[f];
  return out;
}

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

window.cloudSave = state => {
  if (!auth.currentUser) return;
  // JSON を通すと、Firestore が受け付けない undefined などが取り除かれる
  const clean = JSON.parse(JSON.stringify(state));
  const batch = writeBatch(db);
  let changes = 0;

  const staffDoc = { staffList: clean.staffList || [] };
  const staffJSON = JSON.stringify(staffDoc);
  if (knownJSON.get("staff") !== staffJSON) {
    batch.set(staffRef, staffDoc); knownJSON.set("staff", staffJSON); changes++;
  }

  const months = new Set();
  for (const f of MONTH_FIELDS) Object.keys(clean[f] || {}).forEach(ym => months.add(ym));
  for (const ym of months) {
    const m = {};
    for (const f of MONTH_FIELDS) if (clean[f] && clean[f][ym] !== undefined) m[f] = clean[f][ym];
    const json = JSON.stringify(m);
    if (knownJSON.get("month:" + ym) !== json) {
      batch.set(doc(monthsCol, ym), m); knownJSON.set("month:" + ym, json); changes++;
    }
  }
  // 画面側で消された月（全データ削除など）はクラウドからも消す
  for (const key of [...knownJSON.keys()]) {
    if (key.startsWith("month:") && !months.has(key.slice(6))) {
      batch.delete(doc(monthsCol, key.slice(6))); knownJSON.delete(key); changes++;
    }
  }
  if (!changes) return;

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
};
