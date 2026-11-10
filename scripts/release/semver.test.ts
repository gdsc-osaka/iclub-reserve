import { describe, expect, it } from "vite-plus/test";

import { compareSemver, isPrerelease, parseSemver, type Semver } from "./semver.js";

const parse = (text: string): Semver => {
  const version = parseSemver(text);
  if (!version) throw new Error(`${text} を読めませんでした`);
  return version;
};

describe("parseSemver", () => {
  it("版の数と、- から後を読む", () => {
    expect(parseSemver("1.0.0-rc.1")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ["rc", 1],
    });
    expect(parseSemver("10.20.30")).toEqual({ major: 10, minor: 20, patch: 30, prerelease: [] });
  });

  it.each(["1.0", "v1.0.0", "01.0.0", "1.0.0-", "1.0.0-rc.01", "1.0.0+build.1", "1.0.0 "])(
    "semver の形でない %s は null にする",
    (text) => {
      expect(parseSemver(text)).toBeNull();
    },
  );

  it("数として正しく扱えない桁の多い版は null にする", () => {
    expect(parseSemver("99999999999999999.0.0")).toBeNull();
  });
});

describe("compareSemver", () => {
  // semver 2.0.0 の 11 節の例と、RC から正式な版に移る流れ
  const ordered = [
    "0.0.0",
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0-rc.2",
    "1.0.0-rc.10",
    "1.0.0",
    "1.0.1",
    "1.1.0",
    "2.0.0",
  ];

  it.each(ordered.slice(1).map((version, i) => [ordered[i], version]))(
    "%s < %s",
    (smaller, larger) => {
      expect(compareSemver(parse(smaller), parse(larger))).toBeLessThan(0);
      expect(compareSemver(parse(larger), parse(smaller))).toBeGreaterThan(0);
    },
  );

  it("同じ版は 0", () => {
    expect(compareSemver(parse("1.0.0-rc.1"), parse("1.0.0-rc.1"))).toBe(0);
  });
});

describe("isPrerelease", () => {
  it("- の付いた版だけを pre-release にする", () => {
    expect(isPrerelease(parse("1.0.0-rc.1"))).toBe(true);
    expect(isPrerelease(parse("1.0.0"))).toBe(false);
  });
});
