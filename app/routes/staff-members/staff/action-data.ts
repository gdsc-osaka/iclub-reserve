/** action から戻ってくる、招待フォームの状態 */
export interface StaffInviteFormState {
  readonly submittedEmail: string;
  readonly emailError: string | null;
  readonly formError: string | null;
}

/**
 * action が画面へ返す値。
 *
 * どの区画の操作に失敗したかで形が違うので `section` で判別する。
 * "members"（剥奪の失敗）、"invite"（招待送信の失敗）、"invitations"（取り消しの失敗）を分ける。
 */
export type StaffActionData =
  | { readonly section: "members"; readonly formError: string | null }
  | ({ readonly section: "invite" } & StaffInviteFormState)
  | { readonly section: "invitations"; readonly formError: string | null };
