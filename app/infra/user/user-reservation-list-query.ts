import { and, asc, desc, eq, gte, inArray, not, sql, type SQL } from "drizzle-orm";
import { ok, ResultAsync, type Result } from "neverthrow";

import { facilityTable, member, organization, reservationTable } from "~/db/schema";
import { ACTIVE_RESERVATION_STATUSES } from "~/domain/reservation";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  UserReservationList,
  UserReservationListGroup,
  UserReservationListItem,
  UserReservationListQuery,
} from "~/query/user/user-reservation-list";
import type { Database } from "../db";

/**
 * 「これからの予定」として扱う条件。
 *
 * まだ生きているステータスで、かつ終了時刻を過ぎていないもの。
 * 履歴側はこの条件を `not()` で反転させて作る。そうすることで
 * 「どちらにも入らない予約」「両方に入る予約」が原理的に生まれない。
 *
 * `and()` ではなく `sql` で 1 つの式に畳んでいるのは、
 * drizzle の `and()` が引数を省略できる都合で `SQL | undefined` を返し、
 * そのままでは `not()` に渡せないため。括弧も明示している。
 */
const isUpcoming = (now: Date): SQL =>
  sql`(${inArray(reservationTable.status, [...ACTIVE_RESERVATION_STATUSES])} and ${gte(reservationTable.endAt, now)})`;

/** 予約 1 件として画面に出す列。2 つのクエリで同じ形にそろえる */
const reservationColumns = {
  reservationId: reservationTable.id,
  facilityId: facilityTable.id,
  facilityName: facilityTable.name,
  startAt: reservationTable.startAt,
  endAt: reservationTable.endAt,
  headCount: reservationTable.headCount,
  note: reservationTable.note,
  status: reservationTable.status,
  statusReason: reservationTable.statusReason,
} as const;

/** 団体 1 つとして画面に出す列 */
const groupColumns = {
  groupId: organization.id,
  groupName: organization.name,
  groupStatus: organization.status,
} as const;

export const createUserReservationListQuery = (db: Database): UserReservationListQuery => ({
  findByUserId: (userId, criteria) => {
    /*
     * これからの予定と、所属している団体を一度に取る。
     *
     * 起点を member にして予約を leftJoin しているのがこのクエリの肝。
     * 予約を起点にすると「予約がまだ 1 件も無い団体」の行が消えてしまい、
     * 未所属なのか予約が無いだけなのかを画面で区別できなくなる。
     */
    const upcomingQuery = db
      .select({ ...groupColumns, ...reservationColumns })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .leftJoin(
        reservationTable,
        and(eq(reservationTable.groupId, member.organizationId), isUpcoming(criteria.now)),
      )
      .leftJoin(facilityTable, eq(facilityTable.id, reservationTable.facilityId))
      .where(eq(member.userId, userId))
      .orderBy(asc(reservationTable.startAt));

    /*
     * 履歴。こちらは件数が青天井になりうるので予約を起点にして上限を付ける。
     * 上限より 1 件多く取り、余分が返ったかどうかで「まだ続きがある」を判定する
     * (件数を数えるだけの COUNT クエリをもう 1 本増やさずに済む)。
     */
    const pastQuery = db
      .select({ ...groupColumns, ...reservationColumns })
      .from(reservationTable)
      .innerJoin(
        member,
        and(eq(member.organizationId, reservationTable.groupId), eq(member.userId, userId)),
      )
      .innerJoin(organization, eq(organization.id, reservationTable.groupId))
      .innerJoin(facilityTable, eq(facilityTable.id, reservationTable.facilityId))
      .where(not(isUpcoming(criteria.now)))
      .orderBy(desc(reservationTable.startAt))
      .limit(criteria.pastLimit + 1);

    /*
     * 2 本を同時に投げる。片方の結果をもう片方が待つ必要はないので、
     * 往復の待ち時間は 1 回分で済む。絞り込みに使う member.userId には member_userId_idx がある。
     *
     * NOTE: ここで `db.batch([...])` を使ってはいけない。
     * 通常の実行は D1 の raw (配列) の結果を列の順番どおりに読むが、
     * batch は列名をキーにしたオブジェクトを経由する (drizzle の d1ToRawMapping)。
     * このクエリのように organization・reservation・facility の `id` や `name` を
     * 同時に選ぶと、同じ列名どうしがオブジェクト上で 1 つに潰れ、
     * 列が 1 つずつずれた値が返る。エラーにはならず、静かに別の列の値が入る。
     */
    return ResultAsync.fromPromise(
      Promise.all([upcomingQuery, pastQuery]),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "予約一覧の取得に失敗しました。",
        cause: error,
      }),
    ).andThen(([upcomingRows, pastRows]) =>
      toUserReservationList(upcomingRows, pastRows, criteria.pastLimit),
    );
  },
});

/** どの行にも必ず入っている団体の列 */
type GroupRow = {
  groupId: string;
  groupName: string;
  groupStatus: UserReservationListGroup["status"];
};

/** 予約が結合されている行。履歴側は innerJoin なのでこの形がそのまま返る */
type ReservationRow = GroupRow & {
  reservationId: string;
  facilityId: string;
  facilityName: string;
  startAt: Date;
  endAt: Date;
  headCount: number;
  note: string | null;
  status: UserReservationListItem["status"];
  statusReason: string | null;
};

/** これから側は leftJoin なので、予約がまだ無い団体では予約の列がまとめて null になる */
type UpcomingRow = GroupRow & {
  reservationId: string | null;
  facilityId: string | null;
  facilityName: string | null;
  startAt: Date | null;
  endAt: Date | null;
  headCount: number | null;
  note: string | null;
  status: UserReservationListItem["status"] | null;
  statusReason: string | null;
};

/** JOIN の結果を、画面が扱いやすい形に組み直す */
const toUserReservationList = (
  upcomingRows: readonly UpcomingRow[],
  pastRows: readonly ReservationRow[],
  pastLimit: number,
): Result<UserReservationList, QueryError> => {
  /*
   * 団体はこちらのクエリからだけ拾う。
   * 履歴側は上限で打ち切られるため、そこから拾うと
   * 「最近の予約が無い団体」が一覧から消えてしまう。
   */
  const groups = new Map<string, UserReservationListGroup>();
  for (const row of upcomingRows) {
    groups.set(row.groupId, { groupId: row.groupId, name: row.groupName, status: row.groupStatus });
  }

  // leftJoin なので、予約が無い団体は予約側が null の行として 1 本返る。
  // flatMap なら「null の行を捨てつつ変換する」が 1 回で書け、型も同時に絞れる。
  const upcoming = upcomingRows.flatMap((row) => (isReservationRow(row) ? [toItem(row)] : []));

  // 上限より 1 件多く取っているので、超えていれば続きがある
  const isPastTruncated = pastRows.length > pastLimit;
  const past = pastRows.slice(0, pastLimit).map((row) => toItem(row));

  return ok({
    groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "ja")),
    upcoming,
    past,
    isPastTruncated,
  });
};

/** 予約が結合されている行かどうかを判定する */
const isReservationRow = (row: UpcomingRow): row is ReservationRow =>
  row.reservationId !== null &&
  row.facilityId !== null &&
  row.facilityName !== null &&
  row.startAt !== null &&
  row.endAt !== null &&
  row.headCount !== null &&
  row.status !== null;

const toItem = (row: ReservationRow): UserReservationListItem => ({
  reservationId: row.reservationId,
  groupId: row.groupId,
  groupName: row.groupName,
  facilityId: row.facilityId,
  facilityName: row.facilityName,
  startAt: row.startAt,
  endAt: row.endAt,
  headCount: row.headCount,
  note: row.note,
  status: row.status,
  statusReason: row.statusReason,
});
