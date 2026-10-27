import { describe, expect, it } from "vite-plus/test";

import { reasonTemplates, toReasonWithTemplate } from "./reason-templates";
import { ReservationTransition } from "./transition";

describe("toReasonWithTemplate", () => {
  const template = "定型文のサンプルです。";

  it("欄が空のときは定型文を返す", () => {
    expect(toReasonWithTemplate("", template)).toBe(template);
  });

  it("欄が空白だけのときは定型文を返す", () => {
    expect(toReasonWithTemplate("   ", template)).toBe(template);
    expect(toReasonWithTemplate(" \n \t ", template)).toBe(template);
  });

  it("すでに定型文が含まれているときはそのまま返す", () => {
    expect(toReasonWithTemplate(template, template)).toBe(template);
    expect(toReasonWithTemplate(`先に書いた理由\n${template}`, template)).toBe(
      `先に書いた理由\n${template}`,
    );
  });

  it("何か書いてあるときは改行して定型文を足す", () => {
    expect(toReasonWithTemplate("先に書いた理由", template)).toBe(`先に書いた理由\n${template}`);
  });

  it("末尾に改行や空白があるときはそれらを除いて改行して定型文を足す", () => {
    expect(toReasonWithTemplate("先に書いた理由  \n\n  ", template)).toBe(
      `先に書いた理由\n${template}`,
    );
  });
});

describe("reasonTemplates", () => {
  it("団体の操作と承認には定型文を出さない", () => {
    expect(reasonTemplates[ReservationTransition.Withdraw]).toEqual([]);
    expect(reasonTemplates[ReservationTransition.Cancel]).toEqual([]);
    expect(reasonTemplates[ReservationTransition.Approve]).toEqual([]);
  });

  it("却下と事務局キャンセルには同じ定型文を出す", () => {
    expect(reasonTemplates[ReservationTransition.Reject]).toBe(
      reasonTemplates[ReservationTransition.StaffCancel],
    );
    expect(reasonTemplates[ReservationTransition.Reject]).toHaveLength(4);
    expect(reasonTemplates[ReservationTransition.Reject].map((t) => t.label)).toEqual([
      "別の予約と重なる",
      "施設の行事",
      "工事・点検・災害",
      "利用日の直前",
    ]);
  });
});
