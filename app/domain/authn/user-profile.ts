import { err, ok, type Result } from "neverthrow";
import type { BaseError } from "~/domain/error";

/**
 * 氏名・パスキー名の最大文字数（コードポイント単位）。
 * COND-017・COND-020 により 50 文字とする。
 */
export const USER_NAME_MAX_LENGTH = 50;

/**
 * プロフィール・パスキー名検証時のエラー型。
 */
export interface ProfileValidationError extends BaseError {
  readonly message: string;
  readonly userMessage: string;
}

type NameValidationMessages = {
  readonly entityLabel: string;
  readonly emptyUserMessage: string;
  readonly tooLongUserMessage: string;
};

/**
 * 名前の共通検証ロジック（COND-017 / COND-020）。
 *
 * 1. 前後の空白（全角空白を含む）を取り除く。
 * 2. 1 文字以上 50 文字以下であること（コードポイント単位）。
 * 3. 前後空白を除いた値を返す。
 */
const validateNameInput = (
  raw: string | null | undefined,
  messages: NameValidationMessages,
): Result<string, ProfileValidationError> => {
  if (raw === null || raw === undefined) {
    return err({
      message: `${messages.entityLabel}が送られていない。`,
      userMessage: messages.emptyUserMessage,
    });
  }

  const trimmed = raw.trim();

  if (trimmed === "") {
    return err({
      message: `${messages.entityLabel}が空である。`,
      userMessage: messages.emptyUserMessage,
    });
  }

  // Unicode コードポイント数で数える（サロゲートペアも 1 文字として扱う）
  const codePointLength = [...trimmed].length;
  if (codePointLength > USER_NAME_MAX_LENGTH) {
    return err({
      message: `${messages.entityLabel}が ${USER_NAME_MAX_LENGTH} 文字を超えている。`,
      userMessage: messages.tooLongUserMessage,
    });
  }

  return ok(trimmed);
};

/**
 * 氏名の入力を検証する（COND-017）。
 */
export const validateUserName = (
  raw: string | null | undefined,
): Result<string, ProfileValidationError> =>
  validateNameInput(raw, {
    entityLabel: "氏名",
    emptyUserMessage: "氏名を入力してください。",
    tooLongUserMessage: `氏名は ${USER_NAME_MAX_LENGTH} 文字以内で入力してください。`,
  });

/**
 * パスキーの表示名入力を検証する（COND-020）。
 */
export const validatePasskeyName = (
  raw: string | null | undefined,
): Result<string, ProfileValidationError> =>
  validateNameInput(raw, {
    entityLabel: "パスキー名",
    emptyUserMessage: "パスキーの名前を入力してください。",
    tooLongUserMessage: `パスキーの名前は ${USER_NAME_MAX_LENGTH} 文字以内で入力してください。`,
  });

/**
 * 初回セットアップ（お名前の登録）が済んでいるかどうか。
 *
 * 認証コードでログインする方式では、未登録のメールアドレスでもその場で
 * アカウントが作られる。このときお名前は空のままなので、
 * 「名前が入っているか」を初回セットアップが済んだかどうかの判定に使っている。
 *
 * 空白だけの名前を通してしまうと画面上は名無しに見えるため、前後の空白は無視する。
 */
export const isProfileCompleted = (user: { readonly name: string }): boolean =>
  user.name.trim() !== "";
