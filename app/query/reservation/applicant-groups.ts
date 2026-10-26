import { and, asc, eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { groupMemberTable, groupTable } from "~/db/schema";
import { wrapError } from "~/domain/error";
import { GroupStatus } from "~/domain/group";
import type { Database } from "~/infra/db";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { ReservationFormGroup } from "~/query/reservation/reservation-form";

export interface FindApplicantGroupsArgs {
  /**
   * 絞り込みに使うユーザー ID。
   *
   * null のときは所属で絞らない。事務局が所属に関わらず
   * 任意の団体として申請できるようにするため（COND-009）。
   */
  readonly memberUserId: string | null;
}

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
export const findApplicantGroups = (
  db: Database,
  args: FindApplicantGroupsArgs,
): ResultAsync<readonly ReservationFormGroup[], QueryError> => {
  const columns = { id: groupTable.id, name: groupTable.name };
  /*
   * 同名の団体があっても並びが入れ替わらないよう、主キーを第 2 キーにする。
   * 団体名には一意制約がなく、名前だけで並べると同名どうしの順序を SQL が保証しない。
   */
  const order = [asc(groupTable.name), asc(groupTable.id)] as const;

  const queryPromise =
    args.memberUserId === null
      ? db
          .select(columns)
          .from(groupTable)
          .where(eq(groupTable.status, GroupStatus.Enabled))
          .orderBy(...order)
      : db
          .select(columns)
          .from(groupMemberTable)
          .innerJoin(groupTable, eq(groupMemberTable.groupId, groupTable.id))
          .where(
            and(
              eq(groupMemberTable.userId, args.memberUserId),
              eq(groupTable.status, GroupStatus.Enabled),
            ),
          )
          .orderBy(...order);

  return ResultAsync.fromPromise(
    queryPromise,
    wrapError(QueryErrorCode.DatabaseError, "申請できる団体の取得に失敗しました。"),
  );
};

/**
 * 読み取り専用の窓口（ポート / ADR-012 決定 8）。
 *
 * 事務局か一般のユーザーかで絞り方を変えるのはユースケースなので（COND-009）、
 * ポートの interface と、関数を呼ぶだけの createApplicantGroupQuery を同じファイルに置く。
 */
export interface ApplicantGroupQuery {
  find(args: FindApplicantGroupsArgs): ResultAsync<readonly ReservationFormGroup[], QueryError>;
}

export const createApplicantGroupQuery = (db: Database): ApplicantGroupQuery => ({
  find: (args) => findApplicantGroups(db, args),
});
