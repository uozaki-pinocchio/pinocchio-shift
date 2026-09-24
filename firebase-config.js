// Firebase の「接続先」の情報。Firebase の管理画面に表示される値をそのまま貼り付ける。
// ※ これは住所のようなもので、公開されても問題ない。データを守っているのは
//    パスワードと、Firebase 側に設定する「セキュリティルール」（firestore.rules）。
export const firebaseConfig = {
  apiKey: "ここにapiKeyを貼り付け",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// スタッフ共通で使うログイン用メールアドレス（画面ではパスワードだけ入力する）
export const LOGIN_EMAIL = "ここに共通アカウントのメールアドレス";
