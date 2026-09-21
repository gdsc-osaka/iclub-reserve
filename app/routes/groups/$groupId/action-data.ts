import type { GroupNameFormState } from "./group-name-form";
import type { GroupInviteFormState } from "./invitation-form";

/**
 * action が画面へ返す値。
 *
 * どの区画の操作に失敗したかで形が違うので `section` で判別する。
 * 1 つの緩い形にまとめると、団体名の誤りがメンバー欄に出るような取り違えが起きる。
 *
 * "invite"（招待送信フォームの失敗）と "invitations"（取り消しの失敗）を分けている理由:
 * この 2 つを 1 つにまとめると、取り消しに失敗したときに招待フォームの入力欄が空に戻ったり、
 * 逆にフォームの誤りが一覧の上に出たりするのを防ぐため。
 */
export type GroupActionData =
  | ({ readonly section: "name" } & GroupNameFormState)
  | { readonly section: "members"; readonly error: string }
  | ({ readonly section: "invite" } & GroupInviteFormState)
  | { readonly section: "invitations"; readonly error: string };
