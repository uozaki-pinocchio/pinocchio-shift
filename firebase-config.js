// Firebase の「接続先」の情報。Firebase の管理画面に表示される値をそのまま貼り付ける。
// ※ これは住所のようなもので、公開されても問題ない。データを守っているのは
//    ログイン用のメールアドレス・パスワードと、Firebase 側に設定する「セキュリティルール」（firestore.rules）。
export const firebaseConfig = {
  apiKey: "AIzaSyCIfSx84MmYqKkRiK-eCfB4vI4_yZ5zOpE",
  authDomain: "pinocchio-shift.firebaseapp.com",
  projectId: "pinocchio-shift",
  storageBucket: "pinocchio-shift.firebasestorage.app",
  messagingSenderId: "953528550102",
  appId: "1:953528550102:web:1c1b2fb7ed4b97b49e3f77"
};

