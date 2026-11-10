import { describe, expect, it } from "vite-plus/test";
import { toMailBodies } from "./mail-bodies";
import type { MailContent } from "./mail-content";

describe("toMailBodies", () => {
  it("同じ中身から、テキスト版と HTML 版の両方を返す", () => {
    const content: MailContent = {
      lead: "本文生成テストです。",
      blocks: [{ type: "paragraph", text: "本文です。" }],
    };

    const bodies = toMailBodies(content);

    expect(bodies.text).toContain("本文生成テストです。");
    expect(bodies.text).toContain("本文です。");
    expect(bodies.html).toContain("<!doctype html>");
    expect(bodies.html).toContain("本文生成テストです。");
    expect(bodies.html).toContain("本文です。");
  });
});
