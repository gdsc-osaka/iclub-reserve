import { describe, expect, it } from "vitest";
import { ALLOWED_EMAIL_DOMAINS_LABEL } from "../authn/allowed-email-domain";
import { GroupErrorCode, GroupField } from "../group";
import { INVITATION_EMAIL_MAX_LENGTH, validateInvitationEmail } from "./invitation-email";

describe("validateInvitationEmail", () => {
  // 1. 許可ドメインのアドレスはそのまま通る
  it("許可ドメインのアドレスはそのまま通る（ok で値が入力と同じ）", () => {
    const email = "taro@osaka-u.ac.jp";
    const result = validateInvitationEmail(email);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("taro@osaka-u.ac.jp");
    }
  });

  // 2. 大文字混じりのアドレスは小文字になって返る
  it("大文字混じりのアドレスは小文字になって返る", () => {
    const email = "Taro.Handai@Osaka-U.ac.jp";
    const result = validateInvitationEmail(email);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("taro.handai@osaka-u.ac.jp");
    }
  });

  // 3. 前後に空白があっても通り、空白は落ちる
  it("前後に空白があっても通り、空白は除去される", () => {
    const email = "  taro@osaka-u.ac.jp   ";
    const result = validateInvitationEmail(email);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("taro@osaka-u.ac.jp");
    }
  });

  // 4. null / undefined / "" / "   " は「入力してください」のエラー
  it.each([null, undefined, "", "   "])(
    "%s の場合は「招待するメールアドレスを入力してください。」のエラーになる",
    (input) => {
      const result = validateInvitationEmail(input);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(GroupErrorCode.InvalidInput);
        expect(result.error.userMessage).toBe("招待するメールアドレスを入力してください。");
      }
    },
  );

  // 5. 途中に空白・改行・タブを含むアドレスはエラー
  it.each([
    "taro hanako@osaka-u.ac.jp",
    "taro\nhanako@osaka-u.ac.jp",
    "taro\thanako@osaka-u.ac.jp",
    "taro@osaka-u.ac.jp hanako@osaka-u.ac.jp",
  ])("%s のように空白・改行・タブを含む場合はエラーになる", (input) => {
    const result = validateInvitationEmail(input);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.InvalidInput);
      expect(result.error.userMessage).toBe("メールアドレスに空白や改行は使えません。");
    }
  });

  // 6. 255 文字以上はエラー、254 文字ちょうどは（ドメインが許可されていれば）通る
  it("255 文字以上はエラーになり、254 文字ちょうどは通る", () => {
    const domain = "@osaka-u.ac.jp"; // 14文字
    // 254文字のアドレスを作成: ローカル部 240文字 + ドメイン 14文字 = 254文字
    const valid254 = "a".repeat(INVITATION_EMAIL_MAX_LENGTH - domain.length) + domain;
    expect(valid254.length).toBe(254);

    const validResult = validateInvitationEmail(valid254);
    expect(validResult.isOk()).toBe(true);

    // 255文字のアドレスを作成: ローカル部 241文字 + ドメイン 14文字 = 255文字
    const invalid255 = "a".repeat(INVITATION_EMAIL_MAX_LENGTH - domain.length + 1) + domain;
    expect(invalid255.length).toBe(255);

    const invalidResult = validateInvitationEmail(invalid255);
    expect(invalidResult.isErr()).toBe(true);
    if (invalidResult.isErr()) {
      expect(invalidResult.error.code).toBe(GroupErrorCode.InvalidInput);
      expect(invalidResult.error.userMessage).toBe("メールアドレスが長すぎます。");
    }
  });

  // 7. 許可外ドメインはエラーで、文言に ALLOWED_EMAIL_DOMAINS_LABEL が含まれる
  it.each(["taro@example.com", "taro@notosaka-u.ac.jp", "taro@gmail.com"])(
    "%s のような許可外ドメインはエラーになり、文言に ALLOWED_EMAIL_DOMAINS_LABEL を含む",
    (input) => {
      const result = validateInvitationEmail(input);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(GroupErrorCode.InvalidInput);
        expect(result.error.userMessage).toContain(ALLOWED_EMAIL_DOMAINS_LABEL);
        expect(result.error.userMessage).toBe(
          `${ALLOWED_EMAIL_DOMAINS_LABEL} のメールアドレスにのみ招待を送れます。`,
        );
      }
    },
  );

  // 8. 形式が壊れているアドレスはエラー（ドメイン部だけを見る isAllowedEmailAddress をすり抜けさせない）
  it.each(["taro@@osaka-u.ac.jp", "a@b@osaka-u.ac.jp", "@osaka-u.ac.jp", "taro@osaka-u.ac.jp."])(
    "%s のように形式が壊れている場合はエラーになる",
    (input) => {
      const result = validateInvitationEmail(input);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(GroupErrorCode.InvalidInput);
        expect(result.error.userMessage).toBe("メールアドレスの形式が正しくありません。");
      }
    },
  );

  // 9. サブドメインは通る
  it("許可ドメインのサブドメイン（例: taro@ecs.osaka-u.ac.jp）は通る", () => {
    const email = "taro@ecs.osaka-u.ac.jp";
    const result = validateInvitationEmail(email);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("taro@ecs.osaka-u.ac.jp");
    }
  });

  // 10. エラーの code はすべて GroupErrorCode.InvalidInput で、項目は招待先のメールアドレス
  it("すべてのエラーケースで code が InvalidInput、field が InviteeEmail である", () => {
    const cases = [
      null,
      "",
      "taro taro@osaka-u.ac.jp",
      "a".repeat(300) + "@osaka-u.ac.jp",
      "taro@example.com",
    ];

    for (const testCase of cases) {
      const result = validateInvitationEmail(testCase);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(GroupErrorCode.InvalidInput);
        // 画面がメールアドレス欄の下に出せるよう、どの項目の誤りかを持っている
        expect(result.error.field).toBe(GroupField.InviteeEmail);
      }
    }
  });

  it("ログに残る message には、入力されたアドレスを埋め込まない（ADR-004 決定 9）", () => {
    // 招待の相手はまだ団体に加わっていない第三者で、そのアドレスは個人情報にあたる
    const cases = ["taro taro@osaka-u.ac.jp", "taro@example.com", "taro@@osaka-u.ac.jp"];

    for (const testCase of cases) {
      const result = validateInvitationEmail(testCase);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).not.toContain("taro");
      }
    }
  });
});
