import { err, ok, type Result } from "neverthrow";

/** メールアドレスの形式が不正だったことを表すエラー */
export type InvalidEmailAddressError = {
  readonly type: "invalid_email_address";
  /** 入力された生の値。ログ用途で保持する */
  readonly input: string;
};

/**
 * メールアドレスを表す値オブジェクト。
 *
 * `createEmailAddress` を通してのみ生成できるため、
 * この型の値を受け取った時点で「形式が検証済み」であることが保証される。
 */
export type EmailAddress = {
  readonly value: string;
  /** ただの string と型レベルで区別するための目印。実行時には使わない */
  readonly __brand: "EmailAddress";
};

/**
 * ローカル部@ドメイン部 の最小限のチェック。
 * RFC 5322 の完全な検証はしない（実在するかは結局送ってみないと分からないため）。
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * メールアドレスの最大長（RFC 5321 が定めるアドレス全体の上限）。
 *
 * 入力欄の `maxLength` など、送信以外の場所でも同じ上限を使いたいので公開している。
 * 値を 2 か所に書くと、片方だけ直したときに「画面は通るが送信で弾かれる」食い違いが起きる。
 */
export const EMAIL_ADDRESS_MAX_LENGTH = 254;

/** 文字列を検証して EmailAddress を生成する */
export const createEmailAddress = (raw: string): Result<EmailAddress, InvalidEmailAddressError> => {
  const value = raw.trim();

  if (value.length === 0 || value.length > EMAIL_ADDRESS_MAX_LENGTH || !EMAIL_PATTERN.test(value)) {
    return err({ type: "invalid_email_address", input: raw });
  }

  const address: EmailAddress = { value, __brand: "EmailAddress" };
  return ok(address);
};
