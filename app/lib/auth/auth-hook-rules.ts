import { err, ok, type Result } from "neverthrow";
import {
  ALLOWED_EMAIL_DOMAINS_LABEL,
  EMAIL_DOMAIN_NOT_ALLOWED_CODE,
  isAllowedEmailAddress,
} from "~/domain/authn/allowed-email-domain";
import { validatePasskeyName, validateUserName } from "~/domain/authn/user-profile";

export interface HookRuleError {
  readonly status: number;
  readonly code: string;
  /**
   * Better Auth の応答にそのまま載り、ブラウザへ届く文言。
   *
   * 画面は `code` から文言を引く（`toAuthErrorMessage`）ので普段は使われないが、
   * API を直接呼ばれたときにも意味の分かる日本語にしておく。ログ用の説明（`message`）は入れない。
   */
  readonly message: string;
}

/**
 * `/email-otp/request-email-change` のフック判定（COND-004 / COND-018）。
 *
 * メールアドレス変更先は osaka-u.ac.jp ドメイン（サブドメイン含む）のみ許可する。
 * アカウントの有無による例外は一切適用せず（COND-004）、DB への問い合わせも行わない。
 */
export const checkRequestEmailChangeRule = (newEmail: unknown): Result<string, HookRuleError> => {
  if (typeof newEmail !== "string" || !isAllowedEmailAddress(newEmail)) {
    return err({
      status: 403,
      code: EMAIL_DOMAIN_NOT_ALLOWED_CODE,
      message: `${ALLOWED_EMAIL_DOMAINS_LABEL} のメールアドレスでのみご利用いただけます。`,
    });
  }
  return ok(newEmail.trim());
};

/**
 * `/update-user` のフック判定（COND-017 / UC-029）。
 *
 * body に name が存在する場合のみ validateUserName を通す。
 * name が無い場合は何も変更せず素通しする。
 * 不正な場合は 400（INVALID_USER_NAME）で拒否する。
 * 成功時は trim した値に差し替える。
 */
export const applyUpdateUserRule = <T extends Record<string, unknown>>(
  body: T,
): Result<{ readonly body: T }, HookRuleError> => {
  if (body.name === undefined) {
    return ok({ body });
  }

  const rawName = typeof body.name === "string" ? body.name : null;
  const result = validateUserName(rawName);
  if (result.isErr()) {
    return err({
      status: 400,
      code: "INVALID_USER_NAME",
      message: result.error.userMessage,
    });
  }

  return ok({
    body: {
      ...body,
      name: result.value,
    },
  });
};

/**
 * `/passkey/verify-registration` のフック判定（COND-020）。
 *
 * ブラウザから送られた name を破棄し、空文字に差し替える。
 * Better Auth は空文字のときのみサーバー側（registration.afterVerification）で付けた名前を採用する。
 * 他の項目はそのまま維持する。
 */
export const applyVerifyRegistrationRule = <T extends Record<string, unknown>>(
  body: T,
): { readonly body: T & { readonly name: string } } => ({
  body: {
    ...body,
    name: "",
  },
});

/**
 * `/passkey/update-passkey` のフック判定（COND-020 / UC-030）。
 *
 * validatePasskeyName を通し、1〜50文字（コードポイント単位）を満たさない場合は 400（INVALID_PASSKEY_NAME）で拒否する。
 * 成功時は trim した値に差し替える。
 */
export const applyUpdatePasskeyRule = <T extends Record<string, unknown>>(
  body: T,
): Result<{ readonly body: T }, HookRuleError> => {
  const rawName = typeof body.name === "string" ? body.name : null;
  const result = validatePasskeyName(rawName);
  if (result.isErr()) {
    return err({
      status: 400,
      code: "INVALID_PASSKEY_NAME",
      message: result.error.userMessage,
    });
  }

  return ok({
    body: {
      ...body,
      name: result.value,
    },
  });
};
