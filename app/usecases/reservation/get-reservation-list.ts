import { errAsync, ResultAsync } from "neverthrow";

import type { Membership } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  ReservationListFacility,
  ReservationListItem,
  ReservationListQuery,
  ReservationListRow,
  ReservationListSort,
  ReservationStatusCounts,
} from "~/query/reservation/reservation-list";
import type {
  UserGroupList,
  UserGroupListItem,
  UserGroupListQuery,
} from "~/query/user/user-group-list";

/** ステータスの絞り込み条件（URLクエリの値に対応） */
export type ReservationListStatusFilter = "all" | "provisional" | "approved" | "ended";

/** 期間の絞り込み条件（URLクエリの値に対応） */
export type ReservationListPeriodFilter = "upcoming" | "past";

/** このユースケースが必要とする依存 */
export interface GetReservationListDeps {
  readonly reservationListQuery: ReservationListQuery;
  /** 「見ている人が所属している団体」を判定・取得する */
  readonly userGroupListQuery: UserGroupListQuery;
}

/** このユースケースへの入力 */
export interface GetReservationListArgs {
  /** 一覧を閲覧しようとしているユーザーの ID */
  readonly actorUserId: string;
  /** そのユーザーが事務局スタッフかどうか（COND-009） */
  readonly isStaff: boolean;
  /**
   * 取得スコープ。
   * - "own": 自団体の予約のみ（/reservations）
   * - "all": 全団体の予約（/staff/reservations。事務局スタッフのみ許可）
   */
  readonly scope: "own" | "all";
  /** 表示対象として指定された団体 ID（scope="own" のときのみ使用） */
  readonly groupId: string | null;
  /** ステータスによる絞り込み */
  readonly status: ReservationListStatusFilter;
  /** 期間（これからの予約 / 過去の予約） */
  readonly period: ReservationListPeriodFilter;
  /** 施設・設備 ID による絞り込み。null のときは全施設 */
  readonly facilityId: string | null;
  /** 判定の基準となる「いま」 */
  readonly now: Date;
}

/** 画面へ渡す予約一覧の集約結果 */
export interface ReservationListResult {
  /** 団体の切り替えタブ用一覧（/reservations で 2 件以上のときに表示） */
  readonly groups: UserGroupList;
  /** 現在選択されている団体（/reservations のみ。所属 0 件のときは null） */
  readonly selectedGroup: UserGroupListItem | null;
  /** 予約一覧 */
  readonly items: readonly ReservationListItem[];
  /** ステータス別件数（絞り込みピルのバッジ用） */
  readonly counts: ReservationStatusCounts;
  /** 施設・設備一覧（絞り込み Select ドロップダウン用） */
  readonly facilities: readonly ReservationListFacility[];
  /**
   * いま見ている人の、表示中の団体での所属。所属していない場合は null。
   *
   * 画面に出す操作ボタンを、ドメインの権限表（reservationPermissions）で
   * 判定するために渡す。判定の中身を画面側に書き写すと、
   * サーバーが許す操作と画面に出る操作がすぐにずれる。
   *
   * 事務局の画面（scope="all"）では、団体での所属ではなく事務局の権限で操作するため null。
   */
  readonly viewerMembership: Membership | null;
}

/** すべての予約ステータス */
const allStatuses: readonly ReservationStatus[] = [
  ReservationStatus.Provisional,
  ReservationStatus.Approved,
  ReservationStatus.Withdrawn,
  ReservationStatus.Rejected,
  ReservationStatus.Cancelled,
  ReservationStatus.CancelledByStaff,
];

/** 終了した予約のステータス */
const endedStatuses: readonly ReservationStatus[] = [
  ReservationStatus.Withdrawn,
  ReservationStatus.Rejected,
  ReservationStatus.Cancelled,
  ReservationStatus.CancelledByStaff,
];

/**
 * 絞り込みキーを実際のドメインステータス配列にマッピングする。
 */
const toDomainStatuses = (filter: ReservationListStatusFilter): readonly ReservationStatus[] => {
  switch (filter) {
    case "provisional":
      return [ReservationStatus.Provisional];
    case "approved":
      return [ReservationStatus.Approved];
    case "ended":
      return endedStatuses;
    case "all":
    default:
      return allStatuses;
  }
};

/**
 * 予約一覧の行から団体の ID を落とし、画面へ渡してよい形に変換する（COND-008）。
 *
 * 団体の ID は「自団体の予約かどうか」の絞り込み判定にのみ使い、
 * 画面へは団体名までしか渡さない。
 */
const toReservationListItem = (row: ReservationListRow): ReservationListItem => ({
  id: row.id,
  groupName: row.groupName,
  facilityId: row.facilityId,
  facilityName: row.facilityName,
  startAt: row.startAt,
  endAt: row.endAt,
  status: row.status,
  statusReason: row.statusReason,
  headCount: row.headCount,
  note: row.note,
  createdByName: row.createdByName,
  createdAt: row.createdAt,
  hasApprovedOverlap: row.hasApprovedOverlap ?? false,
  hasProvisionalOverlap: row.hasProvisionalOverlap ?? false,
});

/**
 * 条件に応じた並び順を決定する。
 *
 * - /staff/reservations の既定（承認待ち・仮予約）: 申請日時の昇順（待たせている団体から順に処理できるようにするため）
 * - period=upcoming: 開始日時の昇順（近いものが上）
 * - period=past: 開始日時の降順
 */
const resolveSort = (
  scope: "own" | "all",
  status: ReservationListStatusFilter,
  period: ReservationListPeriodFilter,
): ReservationListSort => {
  if (scope === "all" && status === "provisional") {
    return "created_at_asc";
  }
  if (period === "past") {
    return "start_at_desc";
  }
  return "start_at_asc";
};

/**
 * 予約一覧・管理画面（SCR-003）に表示するデータを取得するユースケース。
 *
 * 【認可と可視範囲】
 * - `scope: "all"`（全団体の予約）は事務局スタッフ（`isStaff: true`）のみに許す（COND-009）。
 *   一般利用者が開いた場合は `err(FORBIDDEN)` を返す。
 * - `scope: "own"`（自団体の予約）では、**必ず本人が実際に所属している団体の ID だけで絞り込む**。
 *   URL クエリの `group` を直接信用せず、所属外の ID が渡された場合も本人の所属団体の先頭へフォールバックし、
 *   他団体の予約が混ざる事故を確実に防ぐ（COND-008）。
 */
export const getReservationListUseCase = (
  deps: GetReservationListDeps,
  args: GetReservationListArgs,
): ResultAsync<ReservationListResult, QueryError> => {
  // 事務局権限のないユーザーが全団体の一覧を閲覧することは禁止（COND-009）
  if (args.scope === "all" && !args.isStaff) {
    return errAsync({
      code: QueryErrorCode.Forbidden,
      message: "事務局ではない人が、全団体の予約一覧を開こうとした。",
    });
  }

  const statuses = toDomainStatuses(args.status);
  const sort = resolveSort(args.scope, args.status, args.period);
  const from = args.period === "upcoming" ? args.now : null;
  const to = args.period === "past" ? args.now : null;

  // 事務局の全団体閲覧時（scope="all"）
  if (args.scope === "all") {
    return ResultAsync.combine([
      deps.userGroupListQuery.findByUserId(args.actorUserId),
      deps.reservationListQuery.findList({
        groupIds: null, // null で全団体を取得
        statuses,
        facilityId: args.facilityId,
        from,
        to,
        sort,
      }),
      deps.reservationListQuery.countByStatus({
        groupIds: null,
        facilityId: args.facilityId,
        from,
        to,
      }),
      deps.reservationListQuery.findFacilities(),
    ]).map(([groups, rows, counts, facilities]): ReservationListResult => ({
      groups,
      selectedGroup: null,
      items: rows.map(toReservationListItem),
      counts,
      facilities,
      // 事務局の画面では、団体での所属ではなく事務局の権限で操作する（COND-009）
      viewerMembership: null,
    }));
  }

  // 一般利用者の自団体閲覧時（scope="own"）
  return deps.userGroupListQuery.findByUserId(args.actorUserId).andThen((groups) => {
    // どの団体にも所属していない場合
    if (groups.length === 0) {
      return deps.reservationListQuery
        .findFacilities()
        .map((facilities): ReservationListResult => ({
          groups,
          selectedGroup: null,
          items: [],
          counts: { all: 0, provisional: 0, approved: 0, ended: 0 },
          facilities,
          viewerMembership: null,
        }));
    }

    // URL で指定された団体 ID が実際に本人の所属団体に含まれているか検証
    const matchedGroup = groups.find((group) => group.id === args.groupId);
    // 指定がない、または所属外の団体 ID が指定された場合は所属団体の先頭を採用（COND-008）
    const selectedGroup = matchedGroup ?? groups[0];
    const groupIds = [selectedGroup.id];

    return ResultAsync.combine([
      deps.reservationListQuery.findList({
        groupIds,
        statuses,
        facilityId: args.facilityId,
        from,
        to,
        sort,
      }),
      deps.reservationListQuery.countByStatus({
        groupIds,
        facilityId: args.facilityId,
        from,
        to,
      }),
      deps.reservationListQuery.findFacilities(),
    ]).map(([rows, counts, facilities]): ReservationListResult => ({
      groups,
      selectedGroup,
      items: rows.map(toReservationListItem),
      counts,
      facilities,
      viewerMembership: {
        groupId: selectedGroup.id,
        userId: args.actorUserId,
        role: selectedGroup.role,
      },
    }));
  });
};
