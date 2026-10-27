import { describe, expect, it } from "vite-plus/test";

import { generateRandomToken } from "./random-token";

describe("generateRandomToken", () => {
  it("長さ 43 文字の base64url 文字列（パディングなし）を返す", () => {
    const token = generateRandomToken();

    expect(token).toHaveLength(43);
    // URL セーフな base64 文字（A-Z, a-z, 0-9, -, _）のみで構成され、パディング '=' を含まないこと
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain("=");
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
  });

  it("連続して呼び出すと異なるトークンが生成される", () => {
    const token1 = generateRandomToken();
    const token2 = generateRandomToken();

    expect(token1).not.toBe(token2);
  });
});
