/**
 * 画面の共通部分（サイドバー・ボトムバー・アカウントメニュー）が必要とする、
 * ログイン中の人の情報。
 *
 * セッションのユーザーをそのまま渡すと、共通部分が Better Auth の型に依存してしまう。
 * ここで必要な項目だけに絞っておくと、認証まわりを差し替えても
 * 直す場所がローダーだけで済む。
 */
export interface ShellUser {
  readonly name: string;
  readonly email: string;
  /** 事務局スタッフかどうか（COND-009）。ナビの項目が増える。 */
  readonly isStaff: boolean;
}

/**
 * アバターに出す 1 文字。
 *
 * 絵文字や一部の漢字は 1 文字が 2 つ分の長さで数えられるため、
 * `charAt(0)` ではなく配列に開いてから先頭を取る。
 * そうしないと文字が半分に割れて、豆腐（□）になってしまう。
 */
export const toAvatarInitial = (name: string): string => [...name.trim()].at(0) ?? "?";
