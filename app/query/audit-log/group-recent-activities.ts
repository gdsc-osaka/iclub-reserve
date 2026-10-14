import type { ResultAsync } from "neverthrow";

import type { AuditLogAction, AuditLogChanges, AuditLogTargetType } from "~/domain/audit-log";
import type { MembershipRole } from "~/domain/membership";
import type { QueryError } from "../error";

/**
 * ダッシュボード「団体の最近の動き」に出す操作履歴 1 件（SCR-022 / UC-025）。
 *
 * 操作者は名前と `actedAsStaff` のまま返す。「事務局」と伏せるかどうかは見る人で決まるので、
 * ユースケースで `toAuditLogActorView` に通す（COND-012）。
 */
export interface GroupRecentActivityItem {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorName: string | null;
  readonly actedAsStaff: boolean;
  readonly action: AuditLogAction;
  readonly targetType: AuditLogTargetType;
  readonly targetId: string;
  readonly groupId: string;
  readonly groupName: string;
  /** 予約の記録のときだけ。施設名と利用時間帯 */
  readonly reservation: {
    readonly facilityName: string;
    readonly startAt: Date;
    readonly endAt: Date;
  } | null;
  readonly changes: AuditLogChanges;
}

/**
 * 最近の動きを取得する引数。
 */
export interface FindRecentGroupActivitiesArgs {
  /** 見る人。本人の操作を除くのに使う */
  readonly actorUserId: string;
  /** 見る人の所属団体と、その団体での役割。役割で見せる範囲が変わる（COND-012 (2)・(3)） */
  readonly groups: readonly { readonly id: string; readonly role: MembershipRole }[];
  /** この日時以降の記録だけを返す */
  readonly since: Date;
  readonly limit: number;
}

/**
 * 団体の最近の動きの読み取り専用 Query ポート（ADR-001）。
 */
export interface GroupRecentActivitiesQuery {
  /**
   * 所属団体の操作履歴のうち、役割に応じて見せてよいものを新しい順に返す。
   *
   * 本人の操作と、予約に対する事務局の横断権限による操作（`acted_as_staff = true`）は除く。
   * 後者は「確認が必要なこと」に未読として出るため（COND-026）。
   */
  findRecentActivities(
    args: FindRecentGroupActivitiesArgs,
  ): ResultAsync<readonly GroupRecentActivityItem[], QueryError>;
}
