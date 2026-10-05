import { okAsync, ResultAsync, safeTry } from "neverthrow";

import type { GroupRepository } from "~/domain/group";
import type { MembershipRepository } from "~/domain/membership";
import {
  ReservationAction,
  ReservationErrorCode,
  type ReservationError,
  type ReservationRepository,
  type ReservationStatus,
} from "~/domain/reservation";
import { canEditReservation } from "~/domain/reservation/edit";
import { addDays, parseTokyoDateKey, startOfTokyoDay } from "~/lib/date";
import type {
  ReservationFormFacility,
  ReservationFormQuery,
  ReservationFormReservation,
} from "~/query/reservation/reservation-form";
import type { UserGroupListQuery } from "~/query/user/user-group-list";
import { resolveReservationActor } from "./_shared/reservation-authorization";
import { toVisibleReservation } from "./_shared/visible-reservation";

/** 予約変更画面ローダー（UC-005 / UC-017）が必要とする依存 */
export interface GetReservationEditFormDeps {
  readonly reservationRepository: ReservationRepository;
  readonly membershipRepository: MembershipRepository;
  /** 予約の団体名を表示するために使う（団体は変更不可） */
  readonly groupRepository: GroupRepository;
  /** 施設の選択肢と、表示する日の予約一覧を取得するために使う */
  readonly reservationFormQuery: ReservationFormQuery;
  /** 見ている人の所属団体（タイムラインの「自団体」判定）を取得するために使う */
  readonly userGroupListQuery: UserGroupListQuery;
}

/** 予約変更画面ローダーへの入力 */
export interface GetReservationEditFormArgs {
  readonly reservationId: string;
  readonly actorUserId: string;
  readonly isStaff: boolean;
  /**
   * 表示したい日（URL クエリの date）。
   * 指定が無い・壊れているときは予約の開始日（日本時間）を出す。
   */
  readonly dateKey: string | null;
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
  readonly facilities: readonly ReservationFormFacility[];
  readonly reservations: readonly ReservationFormReservation[];
  readonly selectedDay: Date;
}

/**
 * 予約の変更画面（UC-005 / UC-017）に出すデータを取得するユースケース。
 *
 * 変更できるのは自団体のメンバーで、開始前の仮予約または承認済みの予約のみ。
 * action（`editReservationUseCase`）と同じ判定（canEditReservation）を先に通し、
 * 変更できない予約では画面を開かせない。開けてから送信で断られても、入力が無駄になるだけなので。
 *
 * 施設の選択肢と表示する日の予約は、申請フォーム（SCR-002）と同じ Query から読む。
 * 申請元の団体の一覧（`groups`）も一緒に返ってくるが、変更では団体を変えられないので使わない。
 */
export const getReservationEditFormUseCase = (
  deps: GetReservationEditFormDeps,
  args: GetReservationEditFormArgs,
): ResultAsync<GetReservationEditFormResult, ReservationError> =>
  safeTry(async function* () {
    // 1. 予約の取得（無ければ NotFound）
    const reservation = yield* deps.reservationRepository.findById(args.reservationId);

    /*
     * 2. 事務局の役割には変更（Edit）が無いので、事務局であっても所属を引く。
     * editReservationUseCase と同じ判定に揃える。
     */
    const actor = yield* resolveReservationActor(
      deps,
      reservation.groupId,
      args,
      ReservationAction.Edit,
    );

    // 3. 誰が・いまの状態・開始前か（action と同じ判定）。ここで弾かれた予約は画面を開かせない
    yield* canEditReservation(reservation, actor, args.now);

    // 表示する日の決定（指定が無ければ予約の開始日）
    const selectedDay = parseTokyoDateKey(args.dateKey) ?? startOfTokyoDay(reservation.startAt);
    const from = selectedDay;
    const to = addDays(selectedDay, 1);

    // 4. ResultAsync.combine で同時に読む
    const groupTask = deps.groupRepository
      .findById(reservation.groupId)
      .mapErr((error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "団体情報を読み取れなかった。",
        cause: error,
      }));

    // 団体は使わないので、所属で絞るかどうかはどちらでもよい。絞らずに取る
    const formTask = deps.reservationFormQuery
      .find({ memberUserId: null, from, to })
      .mapErr((error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "予約フォーム用データを読み取れなかった。",
        cause: error,
      }));

    const userGroupsTask = deps.userGroupListQuery
      .findByUserId(args.actorUserId)
      .mapErr((error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "所属団体一覧を読み取れなかった。",
        cause: error,
      }));

    const [group, formData, userGroups] = yield* ResultAsync.combine([
      groupTask,
      formTask,
      userGroupsTask,
    ]);

    const myGroupIds = new Set(userGroups.map((g) => g.id));

    /*
     * 表示する日の予約から、変更中の予約そのものを除く。
     *
     * 除かないと自分自身と重なって「承認済みの予約と重なっています」になり、
     * 承認済みの予約の人数や備考を変えるだけの操作すら確認へ進めなくなるため。
     */
    const otherReservations = formData.reservations.filter((r) => r.id !== reservation.id);
    const visibleReservations = otherReservations.map((r) => toVisibleReservation(r, myGroupIds));

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
      facilities: formData.facilities,
      reservations: visibleReservations,
      selectedDay,
    });
  });
