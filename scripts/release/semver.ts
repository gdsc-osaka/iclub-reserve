/**
 * 版（semver 2.0.0）を読み、大小を比べる（ADR-017 決定 2）。
 *
 * 依存を増やさないよう、リリースの検査に要る分だけを書く。
 * ビルドの情報（`+` から後）はタグに入れたくないので、受け付けない。
 */

/** 読み取った版。`prerelease` は `-` から後を `.` で区切ったもの（数字だけのものは数にする） */
export interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly (string | number)[];
}

const NUMBER = "0|[1-9]\\d*";
const PRERELEASE_ID = `(?:${NUMBER}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`;
const SEMVER = new RegExp(
  `^(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})(?:-(${PRERELEASE_ID}(?:\\.${PRERELEASE_ID})*))?$`,
);

/** semver の形でなければ `null` を返す */
export function parseSemver(text: string): Semver | null {
  const match = SEMVER.exec(text);
  if (!match) return null;

  const [, major, minor, patch, prerelease] = match;
  const numbers = [major, minor, patch].map(Number);
  // 桁が多すぎて数として正しく扱えない版は、形が合っていても受け付けない
  if (!numbers.every(Number.isSafeInteger)) return null;

  return {
    major: numbers[0],
    minor: numbers[1],
    patch: numbers[2],
    prerelease: prerelease
      ? prerelease.split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id))
      : [],
  };
}

/** `a` が小さければ負、同じなら 0、大きければ正を返す（semver 2.0.0 の 11 節の順） */
export function compareSemver(a: Semver, b: Semver): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core !== 0) return core;

  // `-` の付いた版は、付いていない版より小さい（1.0.0-rc.1 < 1.0.0）
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length;
  }

  for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i++) {
    const order = comparePrereleaseId(a.prerelease[i], b.prerelease[i]);
    if (order !== 0) return order;
  }
  // 先頭がすべて同じなら、区切りの多いほうが大きい（rc < rc.1）
  return a.prerelease.length - b.prerelease.length;
}

/** 数だけの区切りは数で比べ、文字を含む区切りより小さい。文字を含む区切りどうしは ASCII の順 */
function comparePrereleaseId(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** `-` の付いた版（RC など）なら true。GitHub Release を pre-release にするかどうかに使う */
export function isPrerelease(version: Semver): boolean {
  return version.prerelease.length > 0;
}
