import { err, ok, type Result } from "neverthrow";
import { ALLOWED_EMAIL_DOMAINS_LABEL, isAllowedEmailAddress } from "../authn/allowed-email-domain";
import { GroupErrorCode, type GroupError } from "../group";

/**
 * 招待先メールアドレスの最大文字数。
 *
 * RFC 5321 が定めるメールアドレス全体の上限（254文字）。
 */
export const INVITATION_EMAIL_MAX_LENGTH = 254;

const invalidInput = (message: string): GroupError => ({
  code: GroupErrorCode.GroupInvalidInput,
  message,
});

/**
 * 招待先メールアドレスの入力を検証・正規化する純粋関数。
 *
 * 【小文字に正規化して返す理由】
 * 承諾のときに user.email と突き合わせることになるが、Better Auth も宛先を探すときに
 * email.toLowerCase() で引いている（app/lib/auth/auth.server.ts の hooks.before）。
 * 保存の時点でそろえておかないと、大文字混じりで招待された人が自分の招待を見つけられなくなる。
 *
 * 【正規表現による構文チェックを新しく書かない理由】
 * メールアドレスの形そのもの（"@" があるか、ローカル部・ドメイン部が空でないか等）は
 * isAllowedEmailAddress が既に見ている。判定が 2 か所に分かれると、将来仕様変更時に
 * 食い違いが発生する原因となるため、ドメイン検証は isAllowedEmailAddress に一任している。
 *
 * 【検証規則（この順で実行）】
 * 1. null / undefined の場合はエラー（必須入力）。
 * 2. trim() 後の文字列が空文字の場合はエラー（必須入力）。
 * 3. 文字列内に空白・改行・タブが含まれる場合はエラー（打ち間違いや複数アドレスの一括入力を防ぐ）。
 * 4. 長さが INVITATION_EMAIL_MAX_LENGTH（254文字）を超える場合はエラー。
 * 5. isAllowedEmailAddress が偽の場合はエラー（大阪大学ドメインのアカウントのみ作成可能なため、入口で弾く）。
 * 6. すべて通過した場合は小文字に正規化した文字列を返す。
 */
export const validateInvitationEmail = (
  raw: string | null | undefined,
): Result<string, GroupError> => {
  if (raw === null || raw === undefined) {
    return err(invalidInput("招待するメールアドレスを入力してください。"));
  }

  const trimmed = raw.trim();

  if (trimmed === "") {
    return err(invalidInput("招待するメールアドレスを入力してください。"));
  }

  // trim 後に空白や改行・タブが残っている場合は、打ち間違いや複数入力の可能性があるため禁止する
  if (/\s/.test(trimmed)) {
    return err(invalidInput("メールアドレスに空白や改行は使えません。"));
  }

  // 文字数の数え方は GROUP_NAME_MAX_LENGTH とそろえて String.prototype.length を使用
  if (trimmed.length > INVITATION_EMAIL_MAX_LENGTH) {
    return err(invalidInput("メールアドレスが長すぎます。"));
  }

  if (!isAllowedEmailAddress(trimmed)) {
    return err(
      invalidInput(`${ALLOWED_EMAIL_DOMAINS_LABEL} のメールアドレスにのみ招待を送れます。`),
    );
  }

  return ok(trimmed.toLowerCase());
};
