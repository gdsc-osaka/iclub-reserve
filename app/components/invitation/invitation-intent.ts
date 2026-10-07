/**
 * 招待の承諾・辞退アクションで送信される intent。
 */
export const InvitationIntent = {
  Accept: "accept",
  Reject: "reject",
} as const;
export type InvitationIntent = (typeof InvitationIntent)[keyof typeof InvitationIntent];

/** この画面には入力欄が無いので、誤りはすべてフォームの上に出す */
export interface InvitationActionData {
  readonly formError: string | null;
}
