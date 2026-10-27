import { errAsync, okAsync, type ResultAsync } from "neverthrow";

import { canAct, type Actor, type MembershipRepository } from "~/domain/membership";
import {
  ReservationErrorCode,
  reservationPermissions,
  type ReservationAction,
  type ReservationError,
} from "~/domain/reservation";
import { canViewReservationSummary } from "~/domain/reservation/visibility";

/** 予約の認可判定に必要な依存 */
export interface ReservationAuthorizationDeps {
  readonly membershipRepository: MembershipRepository;
}

/** 誰が操作しようとしているか */
export interface ReservationAccessRequest {
  readonly actorUserId: string;
  /** 事務局の画面からの操作か（COND-030 の (1)）。ルートは requireAreaUser の actsAsStaff を渡す */
  readonly isStaff: boolean;
}

/**
 * 予約が属する団体での操作する人を組み立てる（COND-030 の (1)）。
 *
 * 事務局の画面では団体での役割を使わないため所属を読まず、
 * 利用者の画面では事務局であっても所属を読んで団体での役割だけで操作する。
 * 事務局の画面では取り消し・キャンセルはできず、事務局キャンセルを使う。
 * 団体として取り消すには利用者の画面から行う（COND-030 の (1)）。
 */
export const resolveReservationActor = (
  deps: ReservationAuthorizationDeps,
  groupId: string,
  request: ReservationAccessRequest,
): ResultAsync<Actor, ReservationError> => {
  if (request.isStaff) {
    return okAsync<Actor, ReservationError>({ isStaff: true, membership: null });
  }

  return deps.membershipRepository
    .findByGroupAndUser(groupId, request.actorUserId)
    .mapErr((error): ReservationError => ({
      code: ReservationErrorCode.DatabaseError,
      message: "所属を読み取れなかった。",
      cause: error,
    }))
    .map((membership): Actor => ({ isStaff: false, membership }));
};

/**
 * 組み立て済みの操作する人が、その操作を許されているかを確かめる。
 *
 * 表が答えるのは「できるか」だけなので、断るときに利用者へ出す文言は呼び出し側が渡す。
 */
export const ensureActorCan = (
  actor: Actor,
  action: ReservationAction,
  userMessage: string,
): ResultAsync<null, ReservationError> =>
  canAct(reservationPermissions, actor, action)
    ? okAsync<null, ReservationError>(null)
    : errAsync<null, ReservationError>({
        code: ReservationErrorCode.Forbidden,
        message: `許されていない操作 (${action}) を拒否した。`,
        userMessage,
      });

/**
 * 所属を引いて、その操作が許されているかを確かめる。
 *
 * 判定した操作する人を後から使わない（可視範囲を絞る必要がない）ユースケースは、
 * この 1 本を通すこと。
 */
export const ensureReservationPermission = (
  deps: ReservationAuthorizationDeps,
  groupId: string,
  request: ReservationAccessRequest,
  action: ReservationAction,
  userMessage: string,
): ResultAsync<null, ReservationError> =>
  resolveReservationActor(deps, groupId, request).andThen((actor) =>
    ensureActorCan(actor, action, userMessage),
  );

/**
 * その予約を開いてよいかを確かめる（COND-008 の 2 段目）。
 *
 * 見せられないときは `NotVisible` を返す。利用者には「見つからない」と答える必要があるが
 * （書き分けると、予約 ID を総当たりして存在を確かめられてしまう）、それは画面の側が行う。
 * ここで `NotFound` に潰すと、ログで総当たりを見つけられなくなる（ADR-004 決定 4）。
 *
 * `userMessage` を持たせないこと。持たせても画面には出ないが、
 * 「見られない理由」を書く場所があると、いつか誰かが書いてしまう。
 */
export const ensureCanViewReservation = (actor: Actor): ResultAsync<null, ReservationError> =>
  canViewReservationSummary(actor)
    ? okAsync<null, ReservationError>(null)
    : errAsync<null, ReservationError>({
        code: ReservationErrorCode.NotVisible,
        message: "見る権限の無い予約を開こうとした。",
      });
