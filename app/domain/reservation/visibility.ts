import { canAct, type Actor } from "../membership";
import {
  ReservationAction,
  reservationPermissions,
  type Reservation,
  type ReservationStatus,
} from ".";

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

/**
 * 他団体の人にも見せてよい範囲の予約（COND-008 の 2 段目）。
 *
 * 使用人数・備考・却下/キャンセル理由・作成者は持たない。型から無くしてあるので、
 * この形で受け取った側はそもそもそれらに触れられない。
 *
 * 団体の ID は残している。COND-008 が他団体にも見せてよいとしているのは団体「名」までだが、
 * 予約のエンティティは名前を持たないので、ID を落とすと 2 段目から団体名が消えてしまう。
 * 名前を引くための鍵として渡し、画面へ出すのは名前だけにすること。
 * （一覧や空き状況カレンダーは Query の時点で名前が付いているため、そちらでは ID を落としている）
 */
export interface ReservationSummary {
  readonly id: string;
  readonly facilityId: string;
  readonly groupId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: ReservationStatus;
}

/**
 * 予約 1 件を、見ている人に見せてよい形にしたもの。`canViewDetail` で 2 つの形に分かれる。
 *
 * 判別可能なユニオンにしてあるので、詳細を見られない経路で `note` や `statusReason` に
 * 触れるコードは型エラーになる。`GroupManagementView` の `canManage` と同じ形。
 */
export type ReservationView =
  | { readonly canViewDetail: false; readonly reservation: ReservationSummary }
  | { readonly canViewDetail: true; readonly reservation: Reservation };

/**
 * 予約 1 件を、見ている人に見せてよい形に絞る（COND-008）。
 *
 * 型を絞るだけでなく、実データも詰め替えて捨てる。画面へ渡してから隠しても、
 * 通信の中身を見れば読めてしまうため。
 */
export const toReservationView = (reservation: Reservation, actor: Actor): ReservationView =>
  canViewReservationDetail(actor)
    ? { canViewDetail: true, reservation }
    : {
        canViewDetail: false,
        reservation: {
          id: reservation.id,
          facilityId: reservation.facilityId,
          groupId: reservation.groupId,
          startAt: reservation.startAt,
          endAt: reservation.endAt,
          status: reservation.status,
        },
      };
