import { describe, expect, it } from "vite-plus/test";

import { setPackageVersion } from "./package-version.js";
import { checkReleaseVersion, parseReleaseVersion } from "./version-check.js";

describe("parseReleaseVersion", () => {
  it.each(["0.0.0", "1.0.0-rc.1", "1.0.0-alpha.beta", "10.20.30"])("%s を読む", (text) => {
    expect(parseReleaseVersion(text)?.version).toBe(text);
  });

  // 先頭の v・前後の空白・+ から後は、npm の semver なら読めるが、タグやブランチ名に入れたくないので通さない
  it.each([
    "1.0",
    "v1.0.0",
    " 1.0.0",
    "1.0.0 ",
    "01.0.0",
    "1.0.0-",
    "1.0.0-rc.01",
    "1.0.0+build.1",
    "1.0.0-rc.1+build.1",
    "99999999999999999.0.0",
  ])("「%s」は null にする", (text) => {
    expect(parseReleaseVersion(text)).toBeNull();
  });
});

describe("checkReleaseVersion", () => {
  it("main に version が無ければ 0.0.0 と比べ、最初の RC を通す", () => {
    expect(
      checkReleaseVersion({
        version: "1.0.0-rc.1",
        baseVersion: undefined,
        headRef: "release/v1.0.0-rc.1",
        tagExists: false,
      }),
    ).toEqual([]);
  });

  it("RC から正式な版に上げるのを通す", () => {
    expect(
      checkReleaseVersion({
        version: "1.0.0",
        baseVersion: "1.0.0-rc.2",
        headRef: "release/v1.0.0",
        tagExists: false,
      }),
    ).toEqual([]);
  });

  it("RC の番号は文字でなく数として比べる", () => {
    const check = (version: string, baseVersion: string) =>
      checkReleaseVersion({ version, baseVersion, tagExists: false });

    expect(check("1.0.0-rc.10", "1.0.0-rc.2")).toEqual([]);
    expect(check("1.0.0-rc.9", "1.0.0-rc.10")).toHaveLength(1);
  });

  it("main の版が semver の形でなければ止める", () => {
    expect(
      checkReleaseVersion({ version: "1.0.1", baseVersion: "v1.0.0", tagExists: false }),
    ).toEqual([expect.stringContaining("main の版「v1.0.0」が semver の形ではありません")]);
  });

  it("hotfix のブランチ名も通す", () => {
    expect(
      checkReleaseVersion({
        version: "1.0.1",
        baseVersion: "1.0.0",
        headRef: "hotfix/v1.0.1",
        tagExists: false,
      }),
    ).toEqual([]);
  });

  it("ブランチを作る前の検査では、ブランチ名を見ない", () => {
    expect(
      checkReleaseVersion({ version: "1.0.1", baseVersion: "1.0.0", tagExists: false }),
    ).toEqual([]);
  });

  it("main の版より大きくなければ止める", () => {
    const errors = checkReleaseVersion({
      version: "1.0.0-rc.1",
      baseVersion: "1.0.0",
      headRef: "release/v1.0.0-rc.1",
      tagExists: false,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("main の版「1.0.0」より大きく");
  });

  it("同じ版も止める", () => {
    expect(
      checkReleaseVersion({
        version: "1.0.0",
        baseVersion: "1.0.0",
        headRef: "release/v1.0.0",
        tagExists: false,
      }),
    ).toHaveLength(1);
  });

  it("semver の形でなければ止める", () => {
    const errors = checkReleaseVersion({
      version: "1.0",
      baseVersion: "0.0.0",
      headRef: "release/v1.0",
      tagExists: false,
    });
    expect(errors).toEqual([expect.stringContaining("semver の形ではありません")]);
  });

  it("タグがもうあれば止める", () => {
    expect(
      checkReleaseVersion({
        version: "1.0.1",
        baseVersion: "1.0.0",
        headRef: "hotfix/v1.0.1",
        tagExists: true,
      }),
    ).toEqual([expect.stringContaining("タグ v1.0.1 はもうあります")]);
  });

  it.each(["release/1.0.1", "release/v1.0.2", "feat/v1.0.1", "hotfix/v1.0.1-rc.1"])(
    "ブランチ名 %s は版と合わないので止める",
    (headRef) => {
      expect(
        checkReleaseVersion({ version: "1.0.1", baseVersion: "1.0.0", headRef, tagExists: false }),
      ).toEqual([expect.stringContaining("ブランチ名")]);
    },
  );
});

describe("setPackageVersion", () => {
  it("version の行だけを書き換え、ほかの整形は変えない", () => {
    const before = '{\n  "name": "app",\n  "version": "0.0.0",\n  "private": true\n}\n';
    expect(setPackageVersion(before, "1.0.0-rc.1")).toBe(
      '{\n  "name": "app",\n  "version": "1.0.0-rc.1",\n  "private": true\n}\n',
    );
  });

  it("version が無ければ name の次の行に足す", () => {
    const before = '{\n  "name": "app",\n  "private": true\n}\n';
    expect(setPackageVersion(before, "1.0.1")).toBe(
      '{\n  "name": "app",\n  "version": "1.0.1",\n  "private": true\n}\n',
    );
  });

  it("書き換えられなければ止める", () => {
    expect(() => setPackageVersion('{"name":"app"}', "1.0.1")).toThrow();
  });
});
