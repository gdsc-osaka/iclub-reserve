import { asc, eq } from "drizzle-orm";
import { ok, ResultAsync, safeTry } from "neverthrow";

import { groupMemberTable, groupTable } from "~/db/schema";
import { wrapError } from "~/domain/error";
import type { GroupStatus } from "~/domain/group";
import type { MembershipRole } from "~/domain/membership";
import type { Database } from "~/infra/db";
import { memberCountsByGroup } from "~/infra/group/member-count";
import { toMembershipRole } from "~/infra/membership/membership-converter";
import { QueryErrorCode, type QueryError } from "../error";

/**
 * 一覧に並ぶ団体 1 件分。画面に出す項目だけを持つ。
 *
 * `createdAt` / `updatedAt` を持たせていないのは、どの画面も出していないため。
 * Query は「集約をそのまま返す」のではなく「画面 1 つ分」を返すので、
 * 使わない列は最初から取らない。
 */
export interface UserGroupListItem {
  readonly id: string;
  readonly name: string;
  readonly status: GroupStatus;
  /** その団体でのこのユーザーの役割。管理者かどうかの判定に使う */
  readonly role: MembershipRole;
  /** その団体のメンバー数（SCR-008） */
  readonly memberCount: number;
}

/**
 * 「自分が所属している団体の一覧」画面 1 つ分のデータ。
 *
 * 見出しに当たる情報 (団体数など) は配列の長さから分かるので、
 * `GroupMemberList` のような入れ物のオブジェクトでは包まない。
 */
export type UserGroupList = readonly UserGroupListItem[];

export interface FindUserGroupListArgs {
  /** 一覧を見ようとしているユーザーの ID */
  readonly actorUserId: string;
}

/**
 * 指定したユーザーが所属している団体を、すべて取得する（SCR-008 / UC-035）。
 *
 * - 1 件も所属していない場合: ok([])
 * - DB アクセスに失敗した場合: err(DATABASE_ERROR)
 *
 * NOTE: 所属が 0 件なのは異常ではないので、NOT_FOUND にはしない。
 * ここをエラーにすると、まだどの団体にも入っていない人の画面が
 * 「見つかりません」になってしまう。
 *
 * 並び順は団体名の昇順で固定する。同名の団体は団体 ID の昇順で並べる。
 * 順序を決めずに返すと、再読み込みのたびに一覧の並びが入れ替わって見えるおそれがある。
 *
 * 認可の判定を書いていないのは、判定が要らない形にしてあるため。
 * 取得条件そのものが「actorUserId が所属しているもの」なので、
 * 他人の所属が混ざる余地がない。
 * ここに他人の ID を渡せる引数（例: targetUserId）を足すと
 * その保証が崩れるので、足すときは必ず認可の判定も一緒に入れること。
 *
 * NOTE: 空の ID を弾いていないのは、呼び出し元が
 * `requireRequestUser` で取得したログイン中のユーザーに限られるため。
 * 万一空文字が渡っても、一致する所属が無いので ok([]) になる。
 *
 * groupMemberTable と groupTable を 1 回の問い合わせで結合する。
 * 「所属している ID を引いてから 1 件ずつ団体を引く」書き方にすると、
 * 所属している団体の数だけ DB アクセスが増える (N+1 問題)。
 * D1 は 1 クエリごとにネットワーク往復が入るので、ここは必ず結合で取る。
 * メンバー数も同じ理由で、派生テーブルを結合して同じ問い合わせの中で数える。
 *
 * 所属が 0 件のときに空の配列を返せばよいので、leftJoin ではなく innerJoin でよい。
 * 「ユーザーが存在するのに 0 件」と「ユーザーが存在しない」を
 * この画面で区別する必要がないため。
 */
export const findUserGroupList = (
  db: Database,
  args: FindUserGroupListArgs,
): ResultAsync<UserGroupList, QueryError> =>
  safeTry(async function* () {
    const memberCounts = memberCountsByGroup(db);

    const rows = yield* ResultAsync.fromPromise(
      db
        .select({
          id: groupTable.id,
          name: groupTable.name,
          status: groupTable.status,
          role: groupMemberTable.role,
          memberCount: memberCounts.memberCount,
        })
        .from(groupMemberTable)
        .innerJoin(groupTable, eq(groupMemberTable.groupId, groupTable.id))
        .leftJoin(memberCounts, eq(memberCounts.groupId, groupTable.id))
        .where(eq(groupMemberTable.userId, args.actorUserId))
        /*
         * 同名の団体があっても並びが入れ替わらないよう、主キーを第 2 キーにする。
         * 団体名には一意制約がなく、名前だけで並べると同名どうしの順序を SQL が保証しない。
         */
        .orderBy(asc(groupTable.name), asc(groupTable.id)),
      wrapError(QueryErrorCode.DatabaseError, "所属している団体の取得に失敗しました。"),
    );

    return ok(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        role: toMembershipRole(row.role),
        memberCount: row.memberCount ?? 0,
      })),
    );
  });

/**
 * 読み取り専用の窓口 (ポート / ADR-012 決定 8)。
 *
 * 判断を持つユースケース（`get-reservation-list` など）が偽物を渡して試すために残す。
 * 返る型はドメインの不変条件を持たないので、
 * **この結果を使って更新してはいけない**。更新は必ず Repository を通すこと。
 */
export interface UserGroupListQuery {
  findByUserId(userId: string): ResultAsync<UserGroupList, QueryError>;
}

export const createUserGroupListQuery = (db: Database): UserGroupListQuery => ({
  findByUserId: (userId) => findUserGroupList(db, { actorUserId: userId }),
});
