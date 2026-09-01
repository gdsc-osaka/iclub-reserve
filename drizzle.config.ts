import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle/migrations",
  // `app/db/schema/index.ts` が認証用とアプリ用のスキーマをまとめて re-export する。
  // グロブ（`./app/db/schema/*.ts`）にすると index.ts 経由で同じテーブルを
  // 二重に読み込んでしまうため、入口のファイルだけを指定する。
  schema: "./app/db/schema/index.ts",
  dialect: "sqlite",
  ...(process.env.LOCAL_DB_PATH ? { dbCredentials: { url: process.env.LOCAL_DB_PATH } } : {}),
});
