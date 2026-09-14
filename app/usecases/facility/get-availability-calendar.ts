import { ResultAsync } from "neverthrow";

import { GroupStatus } from "~/domain/group";
import type { QueryError } from "~/query/error";
import type {
  AvailabilityCalendar,
  AvailabilityReservation,
  AvailabilityReservationRow,
  FacilityAvailabilityCalendarQuery,
} from "~/query/facility/facility-availability-calendar";
import type { UserGroupList, UserGroupListQuery } from "~/query/user/user-group-list";

/** このユースケースが必要とする依存 */
export interface GetAvailabilityCalendarDeps {
  readonly facilityAvailabilityCalendarQuery: FacilityAvailabilityCalendarQuery;
  /** 「どの予約が自団体のものか」を判定するために、見ている人の所属を引く */
  readonly userGroupListQuery: UserGroupListQuery;
}

/** このユースケースへの入力 */
export interface GetAvailabilityCalendarArgs {
  /** カレンダーを見ているユーザーの ID */
  readonly actorUserId: string;
  /** そのユーザーが事務局かどうか（COND-009） */
  readonly isStaff: boolean;
  /** 表示する施設・設備の ID。null なら一覧の先頭 */
  readonly facilityId: string | null;
  /** 表示する期間の開始（この時刻を含む） */
  readonly from: Date;
  /** 表示する期間の終了（この時刻を含まない） */
  readonly to: Date;
}

/**
 * 予約 1 件を、見ている人に見せてよい形に絞る（COND-008）。
 *
 * - 自団体のメンバーと事務局: 全項目
 * - ログイン済みの他団体ユーザー: 団体名・施設・日時・ステータスのみ
 *
 * 使用人数と備考を落とすのをここで行うのは、画面に渡す前に落とす必要があるため。
 * 画面へ渡してから隠しても、通信の中身を見れば読めてしまう。
 *
 * 団体の ID も同じ理由で落としている。所属の判定にはここで使うが、
 * 画面は団体名しか出さないので、そのまま渡すと使い道の無い識別子だけが
 * 他団体のぶんまで手元に残ることになる。
 */
const toVisibleReservation = (
  row: AvailabilityReservationRow,
  myGroupIds: ReadonlySet<string>,
  isStaff: boolean,
): AvailabilityReservation => {
  const isOwnGroup = myGroupIds.has(row.groupId);

  return {
    id: row.id,
    groupName: row.groupName,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
    isOwnGroup,
    detail: isOwnGroup || isStaff ? { headCount: row.headCount, note: row.note } : null,
  };
};

/**
 * いま予約を申請できるかどうかを判定する（COND-006 / COND-009）。
 *
 * 承認待ち・無効の団体からは申請できないので、
 * そういう団体にしか所属していない人は申請の導線を押せない状態にする。
 */
const canApplyReservation = (groups: UserGroupList, isStaff: boolean): boolean =>
  isStaff || groups.some((group) => group.status === GroupStatus.Enabled);

/**
 * 空き状況カレンダー（SCR-001 / UC-001）に出すデータを取得するユースケース。
 *
 * 他団体の予約も含めて返すのは、この画面が「施設がいつ空いているか」を
 * 知るためのものだから。自団体の予約だけでは空いているか分からない。
 * そのうえで、他団体の予約は使用人数・備考を落として渡す（COND-008）。
 *
 * 所属団体の取得とカレンダーの取得は同時に投げる。
 * 順に待つと D1 との往復が 2 回分そのまま表示の待ち時間になる。
 *
 * NOTE: 施設を指定しない（facilityId が null）呼び出しを許しているのは、
 * 画面を開いた直後にどの施設を出すかが、施設の一覧を見るまで決まらないため。
 */
export const getAvailabilityCalendarUseCase = (
  deps: GetAvailabilityCalendarDeps,
  args: GetAvailabilityCalendarArgs,
): ResultAsync<AvailabilityCalendar, QueryError> =>
  ResultAsync.combine([
    deps.userGroupListQuery.findByUserId(args.actorUserId),
    deps.facilityAvailabilityCalendarQuery.findByFacilityAndPeriod({
      facilityId: args.facilityId,
      from: args.from,
      to: args.to,
    }),
  ]).map(([groups, calendar]): AvailabilityCalendar => {
    const myGroupIds = new Set(groups.map((group) => group.id));

    return {
      facilities: calendar.facilities,
      facility: calendar.facility,
      reservations: calendar.reservations.map((row) =>
        toVisibleReservation(row, myGroupIds, args.isStaff),
      ),
      canApplyReservation: canApplyReservation(groups, args.isStaff),
    };
  });
