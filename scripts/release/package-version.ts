/**
 * `package.json` の `version` の行を書き換える（ADR-017 決定 3）。
 *
 * JSON として読み直して書くと、整形が変わって差分が増えるので、`version` の行だけを書き換える。
 * `version` が無ければ、`name` の次の行に足す。
 */
export function setPackageVersion(packageJson: string, version: string): string {
  const versionLine = /^(\s*"version":\s*)"[^"]*"/m;
  const next = versionLine.test(packageJson)
    ? packageJson.replace(versionLine, `$1"${version}"`)
    : packageJson.replace(/^(\s*)("name":\s*"[^"]*",)$/m, `$1$2\n$1"version": "${version}",`);

  const written = (JSON.parse(next) as { version?: unknown }).version;
  if (written !== version) {
    throw new Error("package.json の version を書き換えられませんでした。");
  }
  return next;
}
