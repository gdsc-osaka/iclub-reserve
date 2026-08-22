import { describe, expect, it } from "vitest";
import { createMailMessage, type CreateMailMessageInput } from "./mail-message";

const validInput: CreateMailMessageInput = {
  from: { address: "noreply@osaka-u.ac.jp", name: "i-Club 予約システム" },
  to: { address: "taro@osaka-u.ac.jp" },
  subject: "件名",
  text: "本文",
};

describe("createMailMessage", () => {
  it("差出人・宛先・件名・本文が揃っていれば生成できる", () => {
    const result = createMailMessage(validInput);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.from.address.value).toBe("noreply@osaka-u.ac.jp");
    expect(result.value.from.name).toBe("i-Club 予約システム");
    expect(result.value.to.address.value).toBe("taro@osaka-u.ac.jp");
    expect(result.value.subject).toBe("件名");
  });

  it("表示名がない場合は name を持たない", () => {
    const result = createMailMessage(validInput);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.to.name).toBeUndefined();
  });

  it("件名が空なら empty_subject を返す", () => {
    const result = createMailMessage({ ...validInput, subject: "   " });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.type).toBe("empty_subject");
  });

  it("本文が空なら empty_body を返す", () => {
    const result = createMailMessage({ ...validInput, text: "" });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.type).toBe("empty_body");
  });

  it("宛先の形式が不正なら invalid_email_address を返す", () => {
    const result = createMailMessage({ ...validInput, to: { address: "not-an-email" } });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.type).toBe("invalid_email_address");
  });
});
