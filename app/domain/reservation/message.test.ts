import { describe, expect, it } from "vitest";

import { MembershipRole } from "../membership";
import { ReservationErrorCode, ReservationField } from "./index";
import { isSentAsStaff, validateReservationMessageBody } from "./message";

describe("validateReservationMessageBody", () => {
  it("前後の半角・全角の空白と改行を取り除き、途中の改行は残す", () => {
    const input = "　\n\r  こんにちは\n世界\r\nみんな  \n\u3000";
    const result = validateReservationMessageBody(input);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("こんにちは\n世界\nみんな");
  });

  it("\\r\\n と \\r を \\n にそろえ、CRLF で 2000 文字ちょうどになる入力がそろえた後に通る（CR を数えない）", () => {
    // "a\r\n" を 999 回繰り返す（a が 999 文字、CRLF が 999 個）+ "ab"（2文字）
    // 文字列の UTF-16 length は 999 * 3 + 2 = 2999 文字
    // \r\n を \n にそろえると "a\n" * 999 + "ab" = 999 * 2 + 2 = 2000 コードポイント
    const crlfText = "a\r\n".repeat(999) + "ab";
    const result = validateReservationMessageBody(crlfText);

    expect(result.isOk()).toBe(true);
    const normalized = result._unsafeUnwrap();
    expect([...normalized].length).toBe(2000);
    expect(normalized).not.toContain("\r");
  });

  it("絵文字（サロゲートペア）2000 個は通り、2001 個は落ちる", () => {
    const emoji2000 = "🎉".repeat(2000);
    const result2000 = validateReservationMessageBody(emoji2000);
    expect(result2000.isOk()).toBe(true);
    expect([...result2000._unsafeUnwrap()].length).toBe(2000);

    const emoji2001 = "🎉".repeat(2001);
    const result2001 = validateReservationMessageBody(emoji2001);
    expect(result2001.isErr()).toBe(true);
    expect(result2001._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.InvalidInput,
      field: ReservationField.MessageBody,
      userMessage: "メッセージは2000文字以内で入力してください。",
    });
  });

  it("空文字・空白と改行だけの場合は InvalidInput となり「メッセージを入力してください。」を返す", () => {
    const emptyInputs = ["", "   ", "　　", "\n\n\r\n", "  \u3000 \n \r  "];
    for (const input of emptyInputs) {
      const result = validateReservationMessageBody(input);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: ReservationErrorCode.InvalidInput,
        field: ReservationField.MessageBody,
        userMessage: "メッセージを入力してください。",
      });
    }
  });

  it("2001文字の場合はエラーとなり、エラーの message に本文が含まれない", () => {
    const longBody = "a".repeat(2001);
    const result = validateReservationMessageBody(longBody);

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(ReservationErrorCode.InvalidInput);
    expect(error.field).toBe(ReservationField.MessageBody);
    expect(error.userMessage).toBe("メッセージは2000文字以内で入力してください。");
    // ログ用の message に本文そのものが埋め込まれていないこと
    expect(error.message).not.toContain(longBody);
    expect(error.message).toContain("2000");
  });
});

describe("isSentAsStaff", () => {
  it("所属なしの事務局は true", () => {
    expect(isSentAsStaff({ isStaff: true, membership: null })).toBe(true);
  });

  it("所属ありの事務局は false", () => {
    expect(
      isSentAsStaff({
        isStaff: true,
        membership: {
          groupId: "grp_1",
          userId: "usr_1",
          role: MembershipRole.Admin,
        },
      }),
    ).toBe(false);
  });

  it("メンバーは false", () => {
    expect(
      isSentAsStaff({
        isStaff: false,
        membership: {
          groupId: "grp_1",
          userId: "usr_1",
          role: MembershipRole.Member,
        },
      }),
    ).toBe(false);
  });
});
