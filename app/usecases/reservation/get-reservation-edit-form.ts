import { okAsync, type ResultAsync, safeTry } from "neverthrow";

import type { GroupRepository } from "~/domain/group";
import type { MembershipRepository } from "~/domain/membership";
import {
  ReservationErrorCode,
  type ReservationError,
  type ReservationRepository,
  type ReservationStatus,
} from "~/domain/reservation";
import {
  canChangeReservationContent,
  resolveEditMode,
  ReservationEditMode,
} from "~/domain/reservation/edit";
import { resolveReservationActor } from "./_shared/reservation-authorization";

/** 予約変更画面ローダー（UC-005 / UC-017 / ADR-014 決定 16）が必要とする依存 */
export interface GetReservationEditFormDeps {
  readonly reservationRepository: ReservationRepository;
  readonly membershipRepository: MembershipRepository;
  /** 予約の団体名を表示するために使う（団体は変更不可） */
  readonly groupRepository: GroupRepository;
}

/** 予約変更画面ローダーへの入力 */
export interface GetReservationEditFormArgs {
  readonly reservationId: string;
  readonly actorUserId: string;
  /** 事務局の画面からの操作か（COND-030 の (1)） */
  readonly isStaff: boolean;
  readonly now: Date;
}

/** 変更前の予約情報（画面表示用） */
export interface ReservationEditTarget {
  readonly id: string;
  readonly groupName: string;
  readonly facilityId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly headCount: number;
  readonly note: string | null;
  readonly status: ReservationStatus;
}

/** 予約変更画面ローダーの返却値 */
export interface GetReservationEditFormResult {
  readonly reservation: ReservationEditTarget;
  /** 事務局による直接変更か（UC-008） */
  readonly isDirect: boolean;
}

/**
 * 予約の変更（UC-005 / UC-008 / UC-017 / ADR-014 決定 16）に出す変更前の予約を取得するユースケース。
 *
 * 変更できるのは自団体のメンバーまたは事務局で、開始前の仮予約または承認済みの予約のみ。
 * action（`editReservationUseCase` / `editReservationDirectlyUseCase`）と同じ判定を先に通し、
 * 変更できない予約では画面を開かせない。開けてから送信で断られても、入力が無駄になるだけなので。
 *
 * 施設の一覧やカレンダーの予約は、空き状況の読み取りから取得する。
 */
export const getReservationEditFormUseCase = (
  deps: GetReservationEditFormDeps,
  args: GetReservationEditFormArgs,
): ResultAsync<GetReservationEditFormResult, ReservationError> =>
  safeTry(async function* () {
    // 1. 予約の取得（無ければ NotFound）
    const reservation = yield* deps.reservationRepository.findById(args.reservationId);

    const mode = resolveEditMode(args);
    const isDirect = mode === ReservationEditMode.Direct;

    /*
     * 2. 認可を解決する（COND-030 の (1)）。
     * 事務局の画面なら所属を読まず、利用者の画面なら所属を読む。
     */
    const actor = yield* resolveReservationActor(deps, reservation.groupId, args);

    // 3. 誰が・いまの状態・開始前か（action と同じ判定）。ここで弾かれた予約は画面を開かせない
    yield* canChangeReservationContent(reservation, actor, args.now);

    // 4. 団体名の読み取り
    const group = yield* deps.groupRepository
      .findById(reservation.groupId)
      .mapErr((error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "団体情報を読み取れなかった。",
        cause: error,
      }));

    // 5. 返す
    return okAsync({
      reservation: {
        id: reservation.id,
        groupName: group.name,
        facilityId: reservation.facilityId,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
        headCount: reservation.headCount,
        note: reservation.note,
        status: reservation.status,
      },
      isDirect,
    });
  });
