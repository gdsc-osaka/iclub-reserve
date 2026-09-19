import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { facilityTable, member, organization, reservationTable } from "~/db/schema";
import { GroupStatus } from "~/domain/group";
import { calendarVisibleStatuses } from "~/domain/reservation";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  ReservationFormData,
  ReservationFormFacility,
  ReservationFormGroup,
  ReservationFormQuery,
  ReservationFormReservationRow,
} from "~/query/reservation/reservation-form";
import type { Database } from "../db";

/** DB アクセスの失敗を Query のエラーに変える */
const toDatabaseError =
  (message: string) =>
  (error: unknown): QueryError => ({
    code: QueryErrorCode.DatabaseError,
    message,
    cause: error,
  });

/**
 * 申請元として選べる団体を取る。
 *
 * 有効（enabled）な団体だけを返す（COND-006）。承認待ち・無効の団体は、
 * 所属していても申請できないので選択肢に出さない。
 *
 * `memberUserId` が null のときは所属で絞らない。事務局が所属に関わらず
 * 任意の団体として申請できるようにするため（COND-009）。
 *
 * 戻り値の型を明示して結合の有無を吸収しているのは、Drizzle のクエリビルダーが
 * from 句ごとに別の型になるため。呼び出し側はどちらでも同じ配列として扱える。
 */
const selectGroups = async (
  db: Database,
  memberUserId: string | null,
): Promise<ReservationFormGroup[]> => {
  const columns = { id: organization.id, name: organization.name };
  /*
   * 同名の団体があっても並びが入れ替わらないよう、主キーを第 2 キーにする。
   * 団体名には一意制約がなく、名前だけで並べると同名どうしの順序を SQL が保証しない。
   */
  const order = [asc(organization.name), asc(organization.id)] as const;

  if (memberUserId === null) {
    return db
      .select(columns)
      .from(organization)
      .where(eq(organization.status, GroupStatus.Enabled))
      .orderBy(...order);
  }

  return db
    .select(columns)
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(and(eq(member.userId, memberUserId), eq(organization.status, GroupStatus.Enabled)))
    .orderBy(...order);
};

/**
 * 申請先として選べる施設・設備を取る。
 *
 * 無効な施設（`is_active = false`）を外しているのは、これから予約できないため。
 * 無効化には将来の予約がすべて終了していることが条件なので（COND-003）、
 * 外したせいで隠れる予約は無い。
 */
const selectFacilities = (db: Database): Promise<ReservationFormFacility[]> =>
  db
    .select({
      id: facilityTable.id,
      name: facilityTable.name,
      description: facilityTable.description,
    })
    .from(facilityTable)
    .where(eq(facilityTable.isActive, true))
    .orderBy(asc(facilityTable.name), asc(facilityTable.id));

/**
 * 期間と重なる予約を、施設を絞らずにまとめて取る。
 *
 * 施設ごとに取り直さないのは、フォームで施設を切り替えるたびにサーバーへ問い合わせると、
 * 入力し終えた使用人数・備考が消えてしまうため。1 週間ぶん・全施設でも
 * 高々数十件なので、まとめて取って画面側で絞り込む方が速い。
 *
 * 重なりの条件が `開始 < 期間の終わり` かつ `終わり > 期間の始まり` なのは、
 * 期間をまたぐ予約も拾うため。「開始日時が期間の中にあるもの」だけを条件にすると、
 * 前の週から続いている予約が消えて、空いているように見えてしまう。
 *
 * 団体名は結合で一緒に取る。予約の件数だけ団体を引き直すと、
 * その回数だけ D1 との往復が増える（N+1 問題）。
 */
const selectReservations = (
  db: Database,
  from: Date,
  to: Date,
): Promise<ReservationFormReservationRow[]> =>
  db
    .select({
      id: reservationTable.id,
      facilityId: reservationTable.facilityId,
      groupId: reservationTable.groupId,
      groupName: organization.name,
      startAt: reservationTable.startAt,
      endAt: reservationTable.endAt,
      status: reservationTable.status,
    })
    .from(reservationTable)
    .innerJoin(organization, eq(reservationTable.groupId, organization.id))
    .innerJoin(facilityTable, eq(reservationTable.facilityId, facilityTable.id))
    .where(
      and(
        eq(facilityTable.isActive, true),
        // 終了した予約は描かない。理由は calendarVisibleStatuses の説明を参照
        inArray(reservationTable.status, [...calendarVisibleStatuses]),
        lt(reservationTable.startAt, to),
        gt(reservationTable.endAt, from),
      ),
    )
    .orderBy(asc(reservationTable.startAt), asc(reservationTable.id));

/**
 * Cloudflare D1 (Drizzle) を使った ReservationFormQuery の実装。
 *
 * 3 つの問い合わせに依存関係が無いので `combine` で同時に投げる。
 * 順に待つと D1 との往復が 3 回分そのまま表示の待ち時間になる。
 */
export const createReservationFormQuery = (db: Database): ReservationFormQuery => ({
  find: (args) =>
    ResultAsync.combine([
      ResultAsync.fromPromise(
        selectGroups(db, args.memberUserId),
        toDatabaseError("申請できる団体の取得に失敗しました。"),
      ),
      ResultAsync.fromPromise(
        selectFacilities(db),
        toDatabaseError("施設・設備の一覧の取得に失敗しました。"),
      ),
      ResultAsync.fromPromise(
        selectReservations(db, args.from, args.to),
        toDatabaseError("予約の取得に失敗しました。"),
      ),
    ]).map(
      ([groups, facilities, reservations]): ReservationFormData => ({
        groups,
        facilities,
        reservations,
      }),
    ),
});
