import { canAct, type Actor } from "../membership";
import { ReservationAction, reservationPermissions } from ".";

/**
 * 予約の概要を見てよいかを判定する（COND-008 の 2 段目）。
 *
 * いまは権限表の `base` が全員に許しているので、ログイン済みの人には必ず true になる。
 * それでも判定を関数にしてあるのは、可否を決めるのを表の側に留めておくため。
 * 呼び出し側で「ログインしていれば見られる」と書いてしまうと、
 * `base` を空にしても誰にも気づかれずに見え続けることになる。
 */
export const canViewReservationSummary = (actor: Actor): boolean =>
  canAct(reservationPermissions, actor, ReservationAction.ViewSummary);

/**
 * 予約の詳しい項目まで見てよいかを判定する（COND-008 の 1 段目）。
 *
 * 自団体のメンバーと事務局だけが true になる。
 */
export const canViewReservationDetail = (actor: Actor): boolean =>
  canAct(reservationPermissions, actor, ReservationAction.ViewDetail);
