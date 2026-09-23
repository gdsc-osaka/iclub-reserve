import { GroupErrorCode, type GroupError } from "~/domain/group";

/**
 * 招待を扱えないときに返すエラー。
 *
 * 「存在しない」「期限切れ」「取り消し済み」「すでに承諾済み」は、どれもこのコードになる。
 * 利用者から見れば、どれも「この招待ではもう参加できない」という同じ事実だからである。
 * どれに当たったかは `reason` に書き、ログでだけ見分けられるようにする。
 *
 * 宛先が本人ではないときは、こちらではなく `invitationNotVisible` を返すこと。
 * 利用者への応答はどちらも同じ 404 になるが（COND-011）、それを揃えるのは画面の側で、
 * ユースケースは起きたことをそのまま返す（ADR-004 決定 4）。
 *
 * @param reason ログにだけ残す、扱えなかった理由。利用者が入力した値（メールアドレスなど）を埋め込まないこと
 */
export const invitationNotFound = (reason: string): GroupError => ({
  code: GroupErrorCode.InvitationNotFound,
  message: reason,
});

/**
 * 招待はあるが、宛先が本人ではないときに返すエラー。
 *
 * `invitationNotFound` と分けているのは、他人宛ての招待を開こうとしたことを
 * サーバーのログに権限の問題（warn）として残すため。招待 ID は当て推量できないので、
 * ここに来るのは転送されたリンクを開いたか、宛先と別のアカウントでログインしているかのどちらかである。
 * 利用者に見せる応答を `InvitationNotFound` と同じにする（COND-011）のは
 * `app/routes/_shared/group-error.server.ts` の表で、2 つの応答が同じになることをテストで固定している。
 *
 * `userMessage` を持たせないこと。持たせても画面には出ないが、
 * 「見られない理由」を書く場所があると、いつか誰かが書いてしまう。
 */
export const invitationNotVisible = (): GroupError => ({
  code: GroupErrorCode.InvitationNotVisible,
  message: "宛先が本人ではない招待を開こうとした。",
});
