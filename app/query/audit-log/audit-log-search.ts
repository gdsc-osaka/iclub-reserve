import { and, asc, desc, eq, exists, gte, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { ok, ResultAsync, safeTry } from "neverthrow";

import { auditLogTable, facilityTable, groupTable, reservationTable, user } from "~/db/schema";
import {
  AuditLogTargetType,
  parseAuditLogChanges,
  type AuditLogAction,
  type AuditLogChanges,
} from "~/domain/audit-log";
import { wrapError } from "~/domain/error";
import { collectIds } from "~/infra/audit-log/collect-ids";
import type { Database } from "~/infra/db";
import { ensureStaff } from "../_shared/staff";
import { QueryErrorCode, type QueryError } from "../error";

/** 1 ページあたりの操作履歴表示件数 */
export const AUDIT_LOG_PAGE_SIZE = 50;

/** 操作履歴の検索条件 */
export interface AuditLogSearchFilter {
  readonly targetType: AuditLogTargetType | null;
  readonly groupId: string | null;
  readonly actorId: string | null;
  /** この時刻以降（含む）。null は下限なし */
  readonly occurredFrom: Date | null;
  /** この時刻より前（含まない）。null は上限なし */
  readonly occurredBefore: Date | null;
}

/** 1 件の操作履歴情報 */
export interface AuditLogSearchItem {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorId: string;
  /** 操作者名。ユーザーが退会・削除されていれば null */
  readonly actorName: string | null;
  readonly actedAsStaff: boolean;
  readonly action: AuditLogAction;
  readonly targetType: AuditLogTargetType;
  readonly targetId: string;
  readonly groupId: string | null;
  readonly groupName: string | null;
  /** 予約の記録のときだけ。予約の施設名と開始日時 */
  readonly reservation: { facilityName: string; startAt: Date } | null;
  /** 施設/設備の記録のときだけ。施設名 */
  readonly facilityName: string | null;
  /** 変更前・変更後の内容（パース済み） */
  readonly changes: AuditLogChanges;
}

/** 操作履歴の検索結果（1画面分） */
export interface AuditLogSearchResult {
  readonly items: readonly AuditLogSearchItem[];
  readonly hasNextPage: boolean;
  /** 絞り込みの選択肢: 全団体（名前の昇順） */
  readonly groups: readonly { id: string; name: string }[];
  /** 絞り込みの選択肢: 記録に一度でも現れた操作者（名前の昇順） */
  readonly actors: readonly { id: string; name: string }[];
  /** changes に現れる user_id の表示名（ID → 名前） */
  readonly userNames: Readonly<Record<string, string>>;
  /** changes に現れる facility_id の表示名（ID → 名前） */
  readonly facilityNames: Readonly<Record<string, string>>;
}

export interface FindAuditLogSearchResultArgs {
  /** 事務局スタッフかどうか（COND-009 / COND-012(1)）。操作履歴全件の閲覧は事務局限定 */
  readonly isStaff: boolean;
  readonly filter: AuditLogSearchFilter;
  readonly page: number;
}

const searchAuditLogs = async (
  db: Database,
  filter: AuditLogSearchFilter,
  page: number,
): Promise<AuditLogSearchResult> => {
  const offset = (Math.max(1, page) - 1) * AUDIT_LOG_PAGE_SIZE;

  // 同じ facility テーブルを「予約の施設」と「施設/設備の記録の対象施設」の 2 回参照するため別名をつける
  const reservationFacility = alias(facilityTable, "reservation_facility");
  const targetFacility = alias(facilityTable, "target_facility");

  // 絞り込み条件の構築
  const conditions = [];
  if (filter.targetType !== null) {
    conditions.push(eq(auditLogTable.targetType, filter.targetType));
  }
  if (filter.groupId !== null) {
    conditions.push(eq(auditLogTable.groupId, filter.groupId));
  }
  if (filter.actorId !== null) {
    conditions.push(eq(auditLogTable.actorId, filter.actorId));
  }
  if (filter.occurredFrom !== null) {
    conditions.push(gte(auditLogTable.occurredAt, filter.occurredFrom));
  }
  if (filter.occurredBefore !== null) {
    conditions.push(lt(auditLogTable.occurredAt, filter.occurredBefore));
  }

  // 1. 記録本体（参照先が消えていても記録を落とさないよう、すべて LEFT JOIN）
  const logsQuery = db
    .select({
      id: auditLogTable.id,
      occurredAt: auditLogTable.occurredAt,
      actorId: auditLogTable.actorId,
      /*
       * 名前の列には別名を付ける。D1 の db.batch() は 1 行を「列名 → 値」のオブジェクトで受け取ってから
       * 並べ直すので、同じ名前の列（ここでは 4 つの name）があると 1 つに潰れ、後ろの列がずれてしまう。
       * 単体で実行したときは起きないので、気づきにくい。
       */
      actorName: sql<string | null>`${user.name}`.as("actor_name"),
      actedAsStaff: auditLogTable.actedAsStaff,
      action: auditLogTable.action,
      targetType: auditLogTable.targetType,
      targetId: auditLogTable.targetId,
      groupId: auditLogTable.groupId,
      groupName: sql<string | null>`${groupTable.name}`.as("group_name"),
      reservationFacilityName: sql<string | null>`${reservationFacility.name}`.as(
        "reservation_facility_name",
      ),
      reservationStartAt: reservationTable.startAt,
      targetFacilityName: sql<string | null>`${targetFacility.name}`.as("target_facility_name"),
      changes: auditLogTable.changes,
    })
    .from(auditLogTable)
    .leftJoin(user, eq(user.id, auditLogTable.actorId))
    .leftJoin(groupTable, eq(groupTable.id, auditLogTable.groupId))
    .leftJoin(
      reservationTable,
      and(
        eq(auditLogTable.targetType, AuditLogTargetType.Reservation),
        eq(reservationTable.id, auditLogTable.targetId),
      ),
    )
    .leftJoin(reservationFacility, eq(reservationFacility.id, reservationTable.facilityId))
    .leftJoin(
      targetFacility,
      and(
        eq(auditLogTable.targetType, AuditLogTargetType.Facility),
        eq(targetFacility.id, auditLogTable.targetId),
      ),
    )
    .where(and(...conditions))
    // 同じ時刻の記録でもページ送りで順序が揺れないよう、id でも並べる
    .orderBy(desc(auditLogTable.occurredAt), desc(auditLogTable.id))
    // 次のページがあるかを数えずに知るため、1 件多く取る
    .limit(AUDIT_LOG_PAGE_SIZE + 1)
    .offset(offset);

  // 2. 団体の選択肢（全団体を名前の昇順）
  const groupsQuery = db
    .select({ id: groupTable.id, name: groupTable.name })
    .from(groupTable)
    .orderBy(asc(groupTable.name), asc(groupTable.id));

  /*
   * 3. 操作者の選択肢（記録に一度でも現れた人を名前の昇順）
   * 記録は無期限に増えるので、記録を全部なめて DISTINCT を取るのではなく、ユーザーごとに
   * 記録があるかをインデックス（audit_log_actor_idx）で確かめる。消えたユーザーは名前を出せないので含めない。
   */
  const actorsQuery = db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(
      exists(
        db
          .select({ one: sql`1` })
          .from(auditLogTable)
          .where(eq(auditLogTable.actorId, user.id)),
      ),
    )
    .orderBy(asc(user.name), asc(user.id));

  // 3 つは互いに独立しているので、1 回の往復にまとめる
  const [logRows, groups, actors] = await db.batch([logsQuery, groupsQuery, actorsQuery]);

  const hasNextPage = logRows.length > AUDIT_LOG_PAGE_SIZE;

  const userIds = new Set<string>();
  const facilityIds = new Set<string>();

  const items = logRows.slice(0, AUDIT_LOG_PAGE_SIZE).map((row): AuditLogSearchItem => {
    const changes = parseAuditLogChanges(row.changes);
    collectIds(changes, "user_id", userIds);
    collectIds(changes, "facility_id", facilityIds);

    return {
      id: row.id,
      occurredAt: row.occurredAt,
      actorId: row.actorId,
      actorName: row.actorName,
      actedAsStaff: row.actedAsStaff,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      groupId: row.groupId,
      groupName: row.groupName,
      reservation:
        row.reservationFacilityName !== null && row.reservationStartAt !== null
          ? { facilityName: row.reservationFacilityName, startAt: row.reservationStartAt }
          : null,
      facilityName: row.targetFacilityName,
      changes,
    };
  });

  const result = { items, hasNextPage, groups, actors, userNames: {}, facilityNames: {} };
  if (userIds.size === 0 && facilityIds.size === 0) return result;

  /*
   * changes に出てくる人と施設の名前を、もう 1 回の往復でまとめて引く（N+1 にしない）。
   * 片方の ID が無いときも、inArray は空の配列を「常に偽」にするので、そのまま batch に入れてよい。
   * 1 ページは 50 件で、1 件の changes に user_id・facility_id は 1 つずつ（before と after で 2 つ）なので、
   * ID は 100 個を超えず、D1 の 1 文あたりの引数の上限（100）に収まる。
   */
  const [userRows, facilityRows] = await db.batch([
    db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, [...userIds])),
    db
      .select({ id: facilityTable.id, name: facilityTable.name })
      .from(facilityTable)
      .where(inArray(facilityTable.id, [...facilityIds])),
  ]);

  return {
    ...result,
    userNames: Object.fromEntries(userRows.map((row) => [row.id, row.name])),
    facilityNames: Object.fromEntries(facilityRows.map((row) => [row.id, row.name])),
  };
};

/**
 * 事務局向け操作履歴画面（SCR-018）の検索結果を取得する。
 *
 * 画面 1 つ分に必要な記録、ページ送り情報、絞り込み選択肢、関連名称辞書を返す。
 *
 * 【認可と可視範囲】
 * 全件の操作履歴を閲覧できるのは事務局スタッフ（isStaff: true）のみ（COND-009・COND-012(1)）。
 * 一般利用者が開こうとした場合は、DB 問い合わせを行う前に即座に FORBIDDEN を返す。
 *
 * D1 への往復は最大 2 回。
 * 1 回目で記録本体・団体の選択肢・操作者の選択肢を、2 回目で changes に出てくる人と施設の名前を引く。
 * 2 回目は、名前を引く ID が 1 つも無ければ行わない。
 */
export const findAuditLogSearchResult = (
  db: Database,
  args: FindAuditLogSearchResultArgs,
): ResultAsync<AuditLogSearchResult, QueryError> =>
  safeTry(async function* () {
    yield* ensureStaff(args.isStaff, "事務局ではないユーザーが操作履歴を開こうとした。");

    const result = yield* ResultAsync.fromPromise(
      searchAuditLogs(db, args.filter, args.page),
      wrapError(QueryErrorCode.DatabaseError, "操作履歴を読み取れなかった。"),
    );

    return ok(result);
  });
