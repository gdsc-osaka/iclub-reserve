import { err, ok, type Result } from "neverthrow";
import { ALLOWED_EMAIL_DOMAINS_LABEL, isAllowedEmailAddress } from "../authn/allowed-email-domain";
import { GroupErrorCode, type GroupError } from "../group";
import { createEmailAddress, EMAIL_ADDRESS_MAX_LENGTH } from "../mail/email-address";

/**
 * 招待先メールアドレスの最大文字数。
 *
 * 送信時の検証（`createEmailAddress`）と同じ上限を使う。ここで独自の値を持つと、
 * 画面は通るのに送信で弾かれる、という食い違いが起きる。
 */
export const INVITATION_EMAIL_MAX_LENGTH = EMAIL_ADDRESS_MAX_LENGTH;

const invalidInput = (message: string): GroupError => ({
  code: GroupErrorCode.GroupInvalidInput,
  message,
});

/**
 * 突き合わせ用にメールアドレスの形をそろえる。
 *
 * 招待は保存の時点で小文字に正規化しているので、承諾のときに突き合わせる
 * ログイン中の人のアドレスも同じ形にしてから比べる必要がある。
 * 正規化の規則を 2 か所に書くと、いつか片方だけ変わって
 * 「自分宛ての招待なのに承諾できない」が起きるため、ここ 1 か所に閉じる。
 */
export const normalizeInvitationEmail = (raw: string): string => raw.trim().toLowerCase();

/**
 * 招待先メールアドレスの入力を検証・正規化する純粋関数。
 *
 * 【形式の検証を createEmailAddress に任せる理由】
 * `isAllowedEmailAddress` が見ているのは最後の "@" より後のドメイン部だけなので、
 * `taro@@osaka-u.ac.jp` のような壊れたアドレスも「許可ドメイン」として通ってしまう。
 * それをそのまま招待として保存すると、送信の直前に `createMailMessage` が
 * 同じアドレスを弾き、画面上は成功したのにメールだけ永久に届かない状態になる。
 * 送信時と同じ `createEmailAddress` をここでも通し、形式の判定を 1 か所にそろえる。
 *
 * 【小文字に正規化して返す理由】
 * 承諾のときに user.email と突き合わせることになるが、Better Auth も宛先を探すときに
 * email.toLowerCase() で引いている（app/lib/auth/auth.server.ts の hooks.before）。
 * 保存の時点でそろえておかないと、大文字混じりで招待された人が自分の招待を見つけられなくなる。
 *
 * 【検証規則（この順で実行）】
 * 1. null / undefined の場合はエラー（必須入力）。
 * 2. trim() 後の文字列が空文字の場合はエラー（必須入力）。
 * 3. 文字列内に空白・改行・タブが含まれる場合はエラー（打ち間違いや複数アドレスの一括入力を防ぐ）。
 * 4. 長さが INVITATION_EMAIL_MAX_LENGTH（254文字）を超える場合はエラー。
 * 5. createEmailAddress を通らない形式の場合はエラー。
 * 6. isAllowedEmailAddress が偽の場合はエラー（大阪大学ドメインのアカウントのみ作成可能なため、入口で弾く）。
 * 7. すべて通過した場合は小文字に正規化した文字列を返す。
 *
 * 3・4 は createEmailAddress でも弾かれるが、先に自分で判定している。
 * createEmailAddress の失敗は「形式が不正」の 1 種類しか区別できず、
 * 「空白が入っている」「長すぎる」という直し方の分かる案内を出せないため。
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

  if (createEmailAddress(trimmed).isErr()) {
    return err(invalidInput("メールアドレスの形式が正しくありません。"));
  }

  if (!isAllowedEmailAddress(trimmed)) {
    return err(
      invalidInput(`${ALLOWED_EMAIL_DOMAINS_LABEL} のメールアドレスにのみ招待を送れます。`),
    );
  }

  return ok(normalizeInvitationEmail(trimmed));
};
