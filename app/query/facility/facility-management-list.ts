import { asc, desc } from "drizzle-orm";
import { ok, ResultAsync, safeTry } from "neverthrow";

import { facilityTable } from "~/db/schema";
import { wrapError } from "~/domain/error";
import type { Database } from "~/infra/db";
import { ensureStaff } from "../_shared/staff";
import { QueryErrorCode, type QueryError } from "../error";

/**
 * 事務局向け施設管理一覧画面（SCR-009）の 1 行。
 */
export interface FacilityManagementItem {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly photoUrl: string | null;
  readonly isActive: boolean;
  readonly hasGoogleCalendar: boolean;
  readonly updatedAt: Date;
}

/** 施設管理一覧の配列 */
export type FacilityManagementList = readonly FacilityManagementItem[];

export interface FindFacilityManagementListArgs {
  /** 事務局スタッフかどうか（COND-009）。施設管理一覧の閲覧は事務局限定 */
  readonly isStaff: boolean;
}

/**
 * 全施設・設備の一覧を取得する（SCR-009）。
 *
 * 【認可と可視範囲】
 * 事務局スタッフ（isStaff: true）のみに許可する（COND-009）。
 * 一般利用者が開こうとした場合は、DB 問い合わせを行う前に即座に FORBIDDEN を返す。
 *
 * 並び順:
 * 1. 有効な施設を先に（isActive 降順: true=1, false=0）
 * 2. 施設名の昇順（name 昇順）
 * 3. 施設 ID の昇順（id 昇順）
 */
export const findFacilityManagementList = (
  db: Database,
  args: FindFacilityManagementListArgs,
): ResultAsync<FacilityManagementList, QueryError> =>
  safeTry(async function* () {
    yield* ensureStaff(args.isStaff, "事務局ではないユーザーが施設管理一覧を開こうとした。");

    const rows = yield* ResultAsync.fromPromise(
      db
        .select({
          id: facilityTable.id,
          name: facilityTable.name,
          description: facilityTable.description,
          photoUrl: facilityTable.photoUrl,
          googleCalendarId: facilityTable.googleCalendarId,
          isActive: facilityTable.isActive,
          updatedAt: facilityTable.updatedAt,
        })
        .from(facilityTable)
        .orderBy(desc(facilityTable.isActive), asc(facilityTable.name), asc(facilityTable.id)),
      wrapError(QueryErrorCode.DatabaseError, "施設一覧を読み取れなかった。"),
    );

    return ok(
      rows.map((row): FacilityManagementItem => ({
        id: row.id,
        name: row.name,
        description: row.description,
        photoUrl: row.photoUrl,
        isActive: row.isActive,
        hasGoogleCalendar: row.googleCalendarId !== null && row.googleCalendarId.trim() !== "",
        updatedAt: row.updatedAt,
      })),
    );
  });
