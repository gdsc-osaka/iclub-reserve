import { ResultAsync } from "neverthrow";

import { GroupStatus } from "~/domain/group";
import { canAct, type Actor, type MembershipRole } from "~/domain/membership";
import { ReservationAction, reservationPermissions } from "~/domain/reservation";
import { canChangeReservationContent } from "~/domain/reservation/edit";
import { allowedTransitions, isStaffTransition } from "~/domain/reservation/transition";
import { canViewReservationDetail } from "~/domain/reservation/visibility";
import { addDays, toTokyoDateKey } from "~/lib/date";
import type { QueryError } from "~/query/error";
import type {
  AvailabilityCalendar,
  AvailabilityPeriod,
  AvailabilityPeriods,
  AvailabilityReservation,
  AvailabilityReservationRow,
  FacilityAvailabilityCalendarQuery,
} from "~/query/facility/facility-availability-calendar";
import type { HolidayQuery } from "~/query/holiday";
import type { ApplicantGroupQuery } from "~/query/reservation/applicant-groups";
import type { UserGroupList, UserGroupListQuery } from "~/query/user/user-group-list";

/** このユースケースが必要とする依存 */
export interface GetAvailabilityCalendarDeps {
  readonly facilityAvailabilityCalendarQuery: FacilityAvailabilityCalendarQuery;
  /** 「どの予約が自団体のものか」を判定するために、見ている人の所属を引く */
  readonly userGroupListQuery: UserGroupListQuery;
  /** 表示期間内の祝日を取得するクエリ */
  readonly holidayQuery: HolidayQuery;
  /** 申請元として選べる団体を取得するクエリ */
  readonly applicantGroupQuery: ApplicantGroupQuery;
}

/** このユースケースへの入力 */
export interface GetAvailabilityCalendarArgs {
  /** カレンダーを見ているユーザーの ID */
  readonly actorUserId: string;
  /** そのユーザーが事務局かどうか（COND-009） */
  readonly isStaff: boolean;
  /** 表示する施設・設備の ID。null なら一覧の先頭 */
  readonly facilityId: string | null;
  /**
   * 読む期間。カレンダーに並べる期間と、その外で欄に開いている仮の枠の日（ADR-014 決定 19）。
   * どれか 1 つと重なる予約と、どれか 1 つに入る祝日を返す。
   */
  readonly periods: AvailabilityPeriods;
  /** 「開始日時を過ぎたか」の基準になる現在時刻 */
  readonly now: Date;
}

/** カレンダーを見ている人。行ごとに所属を判定するために持ち回る */
interface CalendarViewer {
  readonly userId: string;
  readonly isStaff: boolean;
  /** 所属している団体の ID と、そこでの役割 */
  readonly rolesByGroupId: ReadonlyMap<string, MembershipRole>;
}

/**
 * 予約 1 件を、見ている人に見せてよい形に絞る（COND-008）。
 *
 * - 自団体のメンバーと事務局: 全項目
 * - ログイン済みの他団体ユーザー: 団体名・施設・日時・ステータスのみ
 *
 * どちらになるかは自前で判定せず、予約の権限表（reservationPermissions）に尋ねる。
 * 判定を画面ごとに書くと、予約詳細（SCR-005）とこの画面で見せる範囲がすぐにずれる。
 *
 * 操作する人は行ごとに組み立てる。1 つを使い回すと、自団体の権限で
 * 他団体の予約を読んでしまう。
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
  viewer: CalendarViewer,
  now: Date,
): AvailabilityReservation => {
  const role = viewer.rolesByGroupId.get(row.groupId);
  const actor: Actor = {
    isStaff: viewer.isStaff,
    membership: role === undefined ? null : { groupId: row.groupId, userId: viewer.userId, role },
  };

  const transitions = allowedTransitions(row, actor).filter(isStaffTransition);

  return {
    id: row.id,
    groupName: row.groupName,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
    isOwnGroup: role !== undefined,
    detail: canViewReservationDetail(actor) ? { headCount: row.headCount, note: row.note } : null,
    transitions,
    canEdit: canChangeReservationContent(row, actor, now).isOk(),
    hasApprovedOverlap: row.hasApprovedOverlap,
    hasProvisionalOverlap: row.hasProvisionalOverlap,
  };
};

/**
 * 期間内の祝日を読む。
 *
 * period.to は終了時刻（排他、翌週日曜 0 時など）で、祝日の読み取りは両端の日を含むので、
 * 期間内の末日（直前の日）を終端とする。
 */
const findHolidaysIn = (holidayQuery: HolidayQuery, period: AvailabilityPeriod) =>
  holidayQuery.findHolidaysBetween(
    toTokyoDateKey(period.from),
    toTokyoDateKey(addDays(period.to, -1)),
  );

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
 * 申請元として選べる団体は、事務局かどうかで変わる。
 * 事務局は所属に関わらず任意の団体として申請できるので、所属で絞らない（COND-009）。
 * 一般のユーザーは自分が所属している有効な団体だけ（COND-006）。
 * 「事務局かどうか」を Query に渡さずにここで絞り方へ翻訳しているのは、
 * この分岐が要件（COND-009）であって、読み取りの都合ではないため。
 *
 * 読み取りは同時に投げる。順に待つと D1 との往復がそのまま待ち時間になる。
 *
 * NOTE: 施設を指定しない（facilityId が null）呼び出しを許しているのは、
 * 画面を開いた直後にどの施設を出すか（まだ選んでもらうか）が、施設の一覧を見るまで決まらないため。
 * 施設が 2 件以上あれば `facility` を null にして返し、画面で選んでもらう（ADR-014 決定 20）。
 */
export const getAvailabilityCalendarUseCase = (
  deps: GetAvailabilityCalendarDeps,
  args: GetAvailabilityCalendarArgs,
): ResultAsync<AvailabilityCalendar, QueryError> =>
  ResultAsync.combine([
    deps.userGroupListQuery.findByUserId(args.actorUserId),
    deps.facilityAvailabilityCalendarQuery.findByFacilityAndPeriods({
      facilityId: args.facilityId,
      periods: args.periods,
    }),
    ResultAsync.combine(args.periods.map((period) => findHolidaysIn(deps.holidayQuery, period))),
    deps.applicantGroupQuery.find({
      memberUserId: args.isStaff ? null : args.actorUserId,
    }),
  ]).map(([groups, calendar, holidaysByPeriod, applicantGroups]): AvailabilityCalendar => {
    const viewer: CalendarViewer = {
      userId: args.actorUserId,
      isStaff: args.isStaff,
      rolesByGroupId: new Map(groups.map((group) => [group.id, group.role])),
    };

    return {
      facilities: calendar.facilities,
      facility: calendar.facility,
      reservations: calendar.reservations.map((row) => toVisibleReservation(row, viewer, args.now)),
      applicantGroups,
      canApplyReservation: canApplyReservation(groups, args.isStaff),
      canCreateDirectly: canAct(
        reservationPermissions,
        { isStaff: args.isStaff, membership: null },
        ReservationAction.CreateDirect,
      ),
      // 期間が重なっていると同じ祝日が 2 回入るので、1 つにまとめる
      holidayDateKeys: [...new Set(holidaysByPeriod.flat())],
    };
  });
