import { describe, expect, it } from "vitest";

import {
  applyUpdatePasskeyRule,
  applyUpdateUserRule,
  applyVerifyRegistrationRule,
  checkRequestEmailChangeRule,
  checkSendVerificationOtpRule,
} from "./auth-hook-rules";

describe("checkSendVerificationOtpRule", () => {
  /** 引かれた宛先を記録する、アカウントの有無の問い合わせ */
  const lookupOf = (registered: readonly string[]) => {
    const asked: string[] = [];
    const hasAccount = async (email: string) => {
      asked.push(email);
      return registered.includes(email);
    };
    return { asked, hasAccount };
  };

  it("大阪大学のドメイン（サブドメインを含む）なら、アカウントを引かずに通す", async () => {
    const { asked, hasAccount } = lookupOf([]);

    expect((await checkSendVerificationOtpRule("user@osaka-u.ac.jp", hasAccount)).isOk()).toBe(
      true,
    );
    expect((await checkSendVerificationOtpRule("user@ist.osaka-u.ac.jp", hasAccount)).isOk()).toBe(
      true,
    );
    expect(asked).toEqual([]);
  });

  it("ほかのドメインでも、既にアカウントがあればログインのために通す（COND-004）", async () => {
    const { asked, hasAccount } = lookupOf(["former@example.com"]);

    const result = await checkSendVerificationOtpRule("Former@Example.com", hasAccount);

    expect(result.isOk()).toBe(true);
    // 小文字にそろえて引く
    expect(asked).toEqual(["former@example.com"]);
  });

  it("ほかのドメインでアカウントも無ければ 403（EMAIL_DOMAIN_NOT_ALLOWED）で拒否する", async () => {
    const { hasAccount } = lookupOf([]);

    const result = await checkSendVerificationOtpRule("someone@example.com", hasAccount);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      status: 403,
      code: "EMAIL_DOMAIN_NOT_ALLOWED",
    });
  });

  it("宛先が文字列でなければ判定しない（body の検証は Better Auth に任せる）", async () => {
    const { asked, hasAccount } = lookupOf([]);

    expect((await checkSendVerificationOtpRule(undefined, hasAccount)).isOk()).toBe(true);
    expect(asked).toEqual([]);
  });
});

describe("checkRequestEmailChangeRule", () => {
  it("許可ドメイン（osaka-u.ac.jp）のメールアドレスなら成功する（既存アカウント有無は引数に取らない）", () => {
    const result = checkRequestEmailChangeRule("user@osaka-u.ac.jp");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("user@osaka-u.ac.jp");
    }

    const subDomainResult = checkRequestEmailChangeRule("user@ist.osaka-u.ac.jp");
    expect(subDomainResult.isOk()).toBe(true);
  });

  it("許可外のドメインは常に 403（EMAIL_DOMAIN_NOT_ALLOWED）で拒否する", () => {
    const result = checkRequestEmailChangeRule("user@gmail.com");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.status).toBe(403);
      expect(result.error.code).toBe("EMAIL_DOMAIN_NOT_ALLOWED");
    }

    const nonStringResult = checkRequestEmailChangeRule(12345);
    expect(nonStringResult.isErr()).toBe(true);
  });
});

describe("applyUpdateUserRule", () => {
  it("name が無ければ何も変更せず素通しする", () => {
    const body = { otherField: "keep-me" };
    const result = applyUpdateUserRule(body);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.body).toEqual(body);
    }
  });

  it("name が不正（空文字や空白のみ）なら 400（INVALID_USER_NAME）で拒否する", () => {
    const emptyResult = applyUpdateUserRule({ name: "" });
    expect(emptyResult.isErr()).toBe(true);
    if (emptyResult.isErr()) {
      expect(emptyResult.error.status).toBe(400);
      expect(emptyResult.error.code).toBe("INVALID_USER_NAME");
    }

    const whitespaceResult = applyUpdateUserRule({ name: "   " });
    expect(whitespaceResult.isErr()).toBe(true);
  });

  it("name が正しければ trim した値に差し替える", () => {
    const result = applyUpdateUserRule({
      name: "　阪大　太郎　",
      extra: "preserve",
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.body.name).toBe("阪大　太郎");
      expect(result.value.body.extra).toBe("preserve");
    }
  });
});

describe("applyVerifyRegistrationRule", () => {
  it('name が空文字（""）に差し替えられ、undefined ではなく、他の項目は維持される', () => {
    const body = {
      name: "Client Provided Name",
      credential: { id: "cred-1" },
      counter: 0,
    };
    const { body: updatedBody } = applyVerifyRegistrationRule(body);

    expect(updatedBody.name).toBe("");
    expect(updatedBody.name).not.toBeUndefined();
    expect(updatedBody.credential).toEqual({ id: "cred-1" });
    expect(updatedBody.counter).toBe(0);
  });
});

describe("applyUpdatePasskeyRule", () => {
  it("50 文字なら通り、51 文字なら 400（INVALID_PASSKEY_NAME）で拒否する", () => {
    const validResult = applyUpdatePasskeyRule({ name: "a".repeat(50) });
    expect(validResult.isOk()).toBe(true);
    if (validResult.isOk()) {
      expect(validResult.value.body.name).toBe("a".repeat(50));
    }

    const tooLongResult = applyUpdatePasskeyRule({ name: "a".repeat(51) });
    expect(tooLongResult.isErr()).toBe(true);
    if (tooLongResult.isErr()) {
      expect(tooLongResult.error.status).toBe(400);
      expect(tooLongResult.error.code).toBe("INVALID_PASSKEY_NAME");
    }
  });
});
