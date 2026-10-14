/**
 * ダッシュボード（SCR-022）の action に送る intent。
 *
 * 画面の部品（`useFetcher` で送る側）と action（振り分ける側）で同じ値を使う。
 */
export const HomeIntent = {
  /** 予約 1 件を確認済みにする（UC-037） */
  MarkRead: "mark-read",
  /** 一覧に出ている予約をまとめて確認済みにする（UC-037） */
  MarkAllRead: "mark-all-read",
  /** 招待を承諾する（UC-022） */
  AcceptInvitation: "accept-invitation",
  /** 招待を辞退する（UC-022） */
  RejectInvitation: "reject-invitation",
} as const;
export type HomeIntent = (typeof HomeIntent)[keyof typeof HomeIntent];

/** action が返す結果。失敗のときは `formError` に利用者へ見せる文言が入る */
export type HomeActionData = { readonly ok: true } | { readonly formError: string | null };
