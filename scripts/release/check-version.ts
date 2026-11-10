/**
 * 出す版を確かめる（ADR-017 決定 2）。GitHub Actions から `pnpm run release:check-version` で動かす。
 *
 * 入力は環境変数で受け取る（ブランチ名を式でシェルに埋め込まないため）。
 *
 * - `RELEASE_VERSION`  出す版
 * - `BASE_VERSION`     main の `package.json` の版（無ければ空）
 * - `HEAD_REF`         PR のブランチ名（ブランチを作る前の検査では空）
 * - `TAG_EXISTS`       タグ `v<版>` がもうあれば `true`
 *
 * 問題があれば、GitHub Actions の注釈（`::error::`）で出して終了コード 1 で終わる。
 */
import { checkReleaseVersion } from "./version-check.js";

const env = (name: string): string | undefined => process.env[name] || undefined;

const version = env("RELEASE_VERSION");
if (!version) {
  console.log("::error::package.json に version がありません。");
  process.exit(1);
}

const errors = checkReleaseVersion({
  version,
  baseVersion: env("BASE_VERSION"),
  headRef: env("HEAD_REF"),
  tagExists: env("TAG_EXISTS") === "true",
});

for (const error of errors) {
  console.log(`::error::${error}`);
}
if (errors.length > 0) process.exit(1);

console.log(`版 ${version} を出せます（main の版: ${env("BASE_VERSION") ?? "なし"}）。`);
