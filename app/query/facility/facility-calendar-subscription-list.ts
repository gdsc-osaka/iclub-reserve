import { asc, eq } from "drizzle-orm";
import { ok, ResultAsync, safeTry } from "neverthrow";

import { facilityTable } from "~/db/schema";
import { wrapError } from "~/domain/error";
import type { Database } from "~/infra/db";
import { ensureStaff } from "../_shared/staff";
import { QueryErrorCode, type QueryError } from "../error";

/**
 * カレンダー一覧・購読ページ（SCR-010 / UC-018）で表示する施設・設備の 1 件。
 */
export interface FacilityCalendarSubscriptionItem {
  readonly id: string;
  readonly name: string;
  readonly googleCalendarId: string | null;
  readonly calendarUrl: string | null;
}

/** カレンダー購読用施設一覧の配列 */
export type FacilityCalendarSubscriptionList = readonly FacilityCalendarSubscriptionItem[];

export interface FindFacilityCalendarSubscriptionListArgs {
  /** 事務局スタッフかどうか（COND-009）。カレンダー購読用の施設一覧の閲覧は事務局限定（ADR-013 決定 7） */
  readonly isStaff: boolean;
}

/**
 * 事務局向けに、有効な施設・設備一覧をカレンダー購読用に取得する（SCR-010 / UC-018 / ADR-012 / ADR-013 決定 7）。
 *
 * 並び順:
 * 1. 施設名の昇順（name 昇順）
 * 2. 施設 ID の昇順（id 昇順）
 * （空き状況カレンダーなどの他の有効施設一覧と同じ並び順）
 */
export const findFacilityCalendarSubscriptionList = (
  db: Database,
  args: FindFacilityCalendarSubscriptionListArgs,
): ResultAsync<FacilityCalendarSubscriptionList, QueryError> =>
  safeTry(async function* () {
    yield* ensureStaff(
      args.isStaff,
      "事務局ではない人が、カレンダー購読用の施設一覧を取得しようとした。",
    );

    const rows = yield* ResultAsync.fromPromise(
      db
        .select({
          id: facilityTable.id,
          name: facilityTable.name,
          googleCalendarId: facilityTable.googleCalendarId,
          calendarUrl: facilityTable.calendarUrl,
        })
        .from(facilityTable)
        .where(eq(facilityTable.isActive, true))
        // 同名の施設があっても並びが入れ替わらないよう、主キーを第 2 キーにする
        .orderBy(asc(facilityTable.name), asc(facilityTable.id)),
      wrapError(QueryErrorCode.DatabaseError, "カレンダー購読用の施設一覧を読み取れなかった。"),
    );

    return ok(rows);
  });
