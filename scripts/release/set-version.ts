/**
 * `package.json` の `version` を書き換える（ADR-017 決定 3）。
 * 「リリースを始める」「hotfix を始める」ワークフローが、版を上げるコミットを作る前に使う。
 *
 * 使い方: `pnpm run release:set-version <版>`（版は環境変数 `RELEASE_VERSION` でも渡せる）
 */
import fs from "node:fs";
import { setPackageVersion } from "./package-version.js";
import { parseReleaseVersion } from "./version-check.js";

const version = process.argv[2] || process.env.RELEASE_VERSION;
if (!version || !parseReleaseVersion(version)) {
  console.error(`版「${version ?? ""}」は semver の形ではありません。`);
  process.exit(1);
}

const path = "package.json";
fs.writeFileSync(path, setPackageVersion(fs.readFileSync(path, "utf8"), version));
console.log(`package.json の version を ${version} にしました。`);
