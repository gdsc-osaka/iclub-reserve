/**
 * 出す版が正しいかを確かめる（ADR-017 決定 2）。
 *
 * `main` 向きの PR のチェック（`Version`）と、「リリースを始める」「hotfix を始める」ワークフローが使う。
 * 版は `package.json` の `version` を正とし、タグ・GitHub Release・ブランチ名をそれに合わせる。
 */
import { compareSemver, parseSemver } from "./semver.js";

export interface VersionCheckInput {
  /** 出す版（PR のブランチの `package.json`、またはワークフローの入力） */
  version: string;
  /** ベースの `main` の `package.json` の版。`version` が無ければ `undefined`（`0.0.0` とみなす） */
  baseVersion: string | undefined;
  /** PR のブランチ名。ブランチを作る前の検査では渡さない */
  headRef?: string;
  /** タグ `v<版>` がもうあるか */
  tagExists: boolean;
}

/** `main` に `version` が無いときに比べる版。最初のリリースの前は `main` に `version` が無い */
export const INITIAL_VERSION = "0.0.0";

/** 版を出すブランチの名前。`release/v<版>`（develop から）と `hotfix/v<版>`（main から） */
export const releaseBranches = (version: string) =>
  [`release/v${version}`, `hotfix/v${version}`] as const;

/** 見つけた問題を、利用者に見せる文で返す。問題が無ければ空の配列 */
export function checkReleaseVersion(input: VersionCheckInput): string[] {
  const errors: string[] = [];

  const version = parseSemver(input.version);
  if (!version) {
    errors.push(
      `版「${input.version}」は semver の形ではありません。1.0.0-rc.1 や 1.0.1 の形にしてください（+ から後は付けません）。`,
    );
  }

  const baseText = input.baseVersion ?? INITIAL_VERSION;
  const base = parseSemver(baseText);
  if (!base) {
    errors.push(`main の版「${baseText}」が semver の形ではありません。`);
  }

  if (version && base && compareSemver(version, base) <= 0) {
    errors.push(`版「${input.version}」は、main の版「${baseText}」より大きくしてください。`);
  }

  if (input.tagExists) {
    errors.push(`タグ v${input.version} はもうあります。版を上げてください。`);
  }

  if (input.headRef !== undefined) {
    const expected = releaseBranches(input.version);
    if (!expected.some((branch) => branch === input.headRef)) {
      errors.push(
        `ブランチ名「${input.headRef}」が版と合いません。${expected.join(" か ")} にしてください。`,
      );
    }
  }

  return errors;
}
