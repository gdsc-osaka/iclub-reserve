/**
 * デモ用アカウント作成スクリプト
 *
 * 使い方:
 *   node scripts/create-demo-accounts.mjs
 *
 * 出力された SQL を以下のコマンドで実行:
 *   pnpm wrangler d1 execute iclub-reserve-db --local --command "<出力されたSQL>"
 *
 * または --file オプション:
 *   node scripts/create-demo-accounts.mjs > /tmp/seed-users.sql
 *   pnpm wrangler d1 execute iclub-reserve-db --local --file /tmp/seed-users.sql
 */

const ITERATIONS = 310_000;
const KEY_LENGTH = 32;

async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    KEY_LENGTH * 8,
  );

  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hashHex = [...new Uint8Array(derivedBits)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `pbkdf2:${ITERATIONS}:${saltHex}:${hashHex}`;
}

function uuid() {
  return crypto.randomUUID().replace(/-/g, "");
}

// ---- デモアカウント定義 ----
const accounts = [
  {
    email: "staff@osaka-u.ac.jp",
    name: "事務局 担当者",
    password: "demo1234",
    isStaff: true,
  },
  {
    email: "group1@osaka-u.ac.jp",
    name: "田中 太郎",
    password: "demo1234",
    isStaff: false,
  },
  {
    email: "group2@osaka-u.ac.jp",
    name: "山田 花子",
    password: "demo1234",
    isStaff: false,
  },
];

const rows = [];
for (const acc of accounts) {
  const hash = await hashPassword(acc.password);
  const id = uuid();
  const now = new Date().toISOString();
  rows.push(
    `INSERT OR IGNORE INTO users (id, email, name, password_hash, is_staff, created_at, updated_at) VALUES ('${id}', '${acc.email}', '${acc.name}', '${hash}', ${acc.isStaff ? 1 : 0}, '${now}', '${now}');`,
  );
}

console.log("-- デモ用アカウント INSERT SQL");
console.log("-- 生成日時: " + new Date().toLocaleString("ja-JP"));
console.log("");
console.log(rows.join("\n"));
console.log("");
console.log("-- アカウント一覧:");
for (const acc of accounts) {
  console.log(`--   ${acc.isStaff ? "[事務局]" : "[団体]  "} ${acc.email} / ${acc.password}`);
}
