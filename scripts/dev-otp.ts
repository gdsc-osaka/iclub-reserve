/**
 * ローカルの開発サーバーでログインするときの、認証コードを読むスクリプト。
 *
 * ローカルでは認証コードのメールを送らず、開発サーバーのターミナルに出すだけ（`createMailSender`）。
 * コーディングエージェントが画面を確かめるとき、ターミナルの出力を探さずに済むよう、
 * Better Auth が D1 に保存した認証コードを直接読んで出す。
 * 手順は `.agents/skills/local-login/SKILL.md` を参照。
 *
 * - `pnpm -s run dev:otp`         シードの人物と、DB に入っているかどうかを一覧にする
 * - `pnpm -s run dev:otp staff`   その人に最後に送ったログインの認証コードを出す（人物の名前かメールアドレス）
 *
 * 読むのはローカルの D1（`.wrangler/state`）だけ。プレビューや本番の DB には触れない。
 */
import { inArray } from "drizzle-orm";
import { user } from "../app/db/schema/index.js";
import { createLocalDrizzleDb, type LocalDrizzleDb } from "./lib/d1.js";
import { otpIdentifier, readLatestOtp } from "./lib/otp.js";
import { seedPersonas } from "./seed/seed-data.js";

type Db = LocalDrizzleDb["db"];

/** 人物の名前（`staff` など）なら、その人のメールアドレスに直す。それ以外はメールアドレスとみなす */
const toEmail = (arg: string): string => {
  const persona = Object.entries(seedPersonas).find(([key]) => key === arg)?.[1];
  // Better Auth はメールアドレスを小文字にしてから保存するので、読むときも合わせる
  return (persona?.email ?? arg).toLowerCase();
};

/** シードの人物を一覧にする。DB に入っていない人には印を付ける */
async function printPersonas(db: Db): Promise<void> {
  const emails = Object.values(seedPersonas).map((persona) => persona.email);
  const rows = await db.select({ email: user.email }).from(user).where(inArray(user.email, emails));
  const seeded = new Set(rows.map((row) => row.email));

  console.log("シードの人物（立場の詳しい説明は scripts/seed/seed-data.ts の seedPersonas）:");
  for (const [key, persona] of Object.entries(seedPersonas)) {
    const mark = seeded.has(persona.email) ? "" : "  ← DB に無い（pnpm run db:seed で入れる）";
    console.log(`  ${key.padEnd(18)} ${persona.email.padEnd(26)} ${persona.name}${mark}`);
  }
}

/** その人に最後に送ったログインの認証コードを出す。数字だけを出すので、そのまま入力に使える */
async function printLatestCode(db: Db, email: string): Promise<void> {
  const code = await readLatestOtp(db, otpIdentifier.signIn(email));
  if (code === null) {
    console.error(
      `${email} に送った認証コードがありません。先にログイン画面か API で認証コードを送ってください。`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(code);
}

const arg = process.argv[2];
const { db, sqlite } = createLocalDrizzleDb();
try {
  if (arg === undefined) {
    await printPersonas(db);
  } else {
    await printLatestCode(db, toEmail(arg));
  }
} finally {
  sqlite.close();
}
