import { and, desc, eq, getTableColumns, gt, sql } from "drizzle-orm";
import { ok, ResultAsync } from "neverthrow";
import { groupInvitationTable, groupMemberTable } from "~/db/schema";
import { GroupErrorCode, type GroupError } from "~/domain/group";
import {
  InvitationStatus,
  type AcceptInvitationInput,
  type CreateInvitationInput,
  type CreateInvitationOutcome,
  type Invitation,
  type InvitationRepository,
  type RejectInvitationInput,
} from "~/domain/invitation";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import type { Database } from "../db";
import { mailOutboxInserts } from "../mail/mail-outbox-writes";
import { toInvitation } from "./invitation-converter";

type GroupMemberValues = typeof groupMemberTable.$inferSelect;

const groupMemberColumns = getTableColumns(groupMemberTable);

/**
 * 値 1 つを `INSERT ... SELECT` の 1 列ぶんの式にする。
 *
 * 値は `sql.param` に列を添えて渡す。Drizzle の列マッパーを通るので、
 * 日時（timestamp_ms）をミリ秒の整数に直す計算をここで書かずに済む。
 * 別名も列の定義から取るため、snake_case を書き写して綴りを間違える余地が無い。
 */
const memberParam = <K extends keyof GroupMemberValues>(key: K, value: GroupMemberValues[K]) =>
  sql<GroupMemberValues[K]>`${sql.param(value, groupMemberColumns[key])}`.as(
    groupMemberColumns[key].name,
  );

/**
 * 承諾のときに `db.batch()` へ渡す 2 文を組む。返す並びが実行順になる。
 *
 * 【2 文が同じ条件を見ることが安全性の要である】
 * `db.batch()` は中の文を無条件に全部実行する。そのため「招待は承諾できなかったのに
 * メンバー行だけできてしまう」ことを防ぐには、メンバーを作る文自身が
 * 「承諾できる招待か」を確かめる必要がある。
 * ここでは 2 文とも `acceptable`（同じ条件）を見るようにして、
 * どちらか一方だけが適用されることを起こらなくしている。
 * **片方にだけ条件を足したり落としたりしてはいけない。**
 *
 * 【メンバーの INSERT を先に実行する理由】
 * INSERT が書くのは `group_member` だけで、`group_invitation` には触らない。
 * そのため後から走る UPDATE から見た招待の状態は変わらず、2 文とも
 * 「書き込み前の同じ行」を条件にできる。逆順にすると、UPDATE が先に
 * `accepted` へ変えてしまい、INSERT 側が同じ条件を見られなくなる。
 *
 * 【「直前の UPDATE が accepted にした行」を条件にしてはいけない理由】
 * ADR-002 の `guardedMailOutboxInserts` と同じ形で、INSERT 側の条件を
 * `status = 'accepted'` にする書き方は**誤り**である。`status` だけでは
 * 「この batch で承諾された行」と「以前に承諾された行」を区別できないため、
 * 一度でも承諾された招待の ID を知っている人なら、宛先が違っても期限が切れていても
 * メンバーになれてしまう（画面には 404 が出るので、権限が付いたことにも気付けない）。
 * outbox がその形で成り立つのは、`reservation` に書き込みのたびに変わる `updated_at` があり、
 * 「この処理が書いた行」まで絞り込めるためである。`group_invitation` にその列は無い。
 *
 * 【団体 ID と役割を招待の行から読む理由】
 * 引数で受け取って渡すこともできるが、それだと「どの招待を承諾したか」と
 * 「どの団体に何の役割で入るか」が別々の経路で決まることになり、食い違う余地が残る。
 * 承諾した招待の行から読めば、その 2 つは必ず一致する。
 *
 * 【一意制約に当たったら何もしない理由】
 * すでにその団体のメンバーである人が、自分宛ての招待をもう一度開いて承諾することがある。
 * `(group_id, user_id)` の一意制約に当たるので、既存の所属をそのまま残す
 * （招待の役割で上書きすると、あとから役割を下げられてしまう）。
 */
export const invitationAcceptStatements = (db: Database, input: AcceptInvitationInput) => {
  /*
   * 承諾できる招待かどうかを決める条件。2 文で必ず同じものを使う。
   * 条件を 1 か所にまとめているのは、2 文に書き分けると食い違いに気付けないため。
   */
  const acceptable = and(
    eq(groupInvitationTable.id, input.invitationId),
    // 取り消し済み・承諾済み・辞退済みの招待を蒸し返さない
    eq(groupInvitationTable.status, InvitationStatus.Pending),
    // 招待メールを転送されただけの人が承諾できないよう、宛先本人に限る（COND-011）
    eq(groupInvitationTable.email, input.email),
    gt(groupInvitationTable.expiresAt, input.now),
  );

  const insertMember = db
    .insert(groupMemberTable)
    .select(
      db
        .select({
          id: memberParam("id", input.membershipId),
          groupId: groupInvitationTable.groupId,
          userId: memberParam("userId", input.userId),
          role: groupInvitationTable.role,
          createdAt: memberParam("createdAt", input.now),
          updatedAt: memberParam("updatedAt", input.now),
        })
        .from(groupInvitationTable)
        .where(acceptable),
    )
    .onConflictDoNothing({
      target: [groupMemberTable.groupId, groupMemberTable.userId],
    });

  const acceptInvitation = db
    .update(groupInvitationTable)
    .set({ status: InvitationStatus.Accepted })
    .where(acceptable)
    .returning({ groupId: groupInvitationTable.groupId });

  return [insertMember, acceptInvitation];
};

/** DB アクセスの失敗をこの層のエラーに包む。文言を 1 か所にまとめるためのもの */
const databaseError =
  (action: string) =>
  (error: unknown): GroupError => ({
    code: GroupErrorCode.DatabaseError,
    message: `招待の${action}に失敗しました。`,
    cause: error,
  });

export const createInvitationRepository = (db: Database): InvitationRepository => {
  const findPendingByGroupAndEmail = (
    groupId: string,
    email: string,
  ): ResultAsync<Invitation | null, GroupError> =>
    ResultAsync.fromPromise(
      db
        .select()
        .from(groupInvitationTable)
        .where(
          and(
            eq(groupInvitationTable.groupId, groupId),
            eq(groupInvitationTable.email, email),
            eq(groupInvitationTable.status, InvitationStatus.Pending),
          ),
        )
        /*
         * 期限の新しいものから取る。
         *
         * 期限切れの招待は送り直せる仕様なので、同じ宛先に「期限切れの pending」と
         * 「有効な pending」が並んで残ることがある。並び順を決めずに limit(1) すると
         * どちらが返るか DB 任せになり、期限切れのほうを拾った回だけ
         * 「有効な招待は無い」と判断して二重に招待を作ってしまう。
         */
        .orderBy(desc(groupInvitationTable.expiresAt))
        .limit(1),
      databaseError("取得"),
    ).andThen((rows) => {
      const row = rows.at(0);
      if (row === undefined) {
        return ok(null);
      }
      return ok(toInvitation(row));
    });

  const create = (
    input: CreateInvitationInput,
    mails: readonly MailDraft[],
  ): ResultAsync<CreateInvitationOutcome, GroupError> => {
    const insertInvitationQuery = db.insert(groupInvitationTable).values({
      id: input.id,
      groupId: input.groupId,
      email: input.email,
      role: input.role,
      status: InvitationStatus.Pending,
      expiresAt: input.expiresAt,
      createdAt: input.createdAt,
      inviterId: input.inviterUserId,
    });

    // メールが無い場合は batch を使わず INSERT 単体で実行する（Drizzle の batch は空配列を受け付けないため）
    if (mails.length === 0) {
      return ResultAsync.fromPromise(insertInvitationQuery, databaseError("作成")).map(() => ({
        enqueuedMailIds: [],
      }));
    }

    /*
     * 招待の INSERT と outbox への INSERT を原子的に行う（ADR-002 決定 3）。
     *
     * ここでは guardedMailOutboxInserts は使わない。
     * 予約のステータス遷移のような「条件付き UPDATE」とは異なり、招待の INSERT は条件付きではないため、
     * INSERT が失敗すれば batch 全体が巻き戻り、outbox へのメールも積まれない。
     */
    const outbox = mailOutboxInserts(db, mails);

    return ResultAsync.fromPromise(
      db.batch([insertInvitationQuery, ...outbox.statements]),
      databaseError("作成および通知メールの登録"),
    ).map(() => ({
      enqueuedMailIds: outbox.ids,
    }));
  };

  const cancel = (groupId: string, invitationId: string): ResultAsync<number, GroupError> =>
    ResultAsync.fromPromise(
      db
        .update(groupInvitationTable)
        .set({ status: InvitationStatus.Canceled })
        .where(
          and(
            eq(groupInvitationTable.id, invitationId),
            /*
             * 他団体の招待を取り消せないよう、必ず団体 ID で絞る。
             * 操作者が意図しない団体の招待 ID を指定しても、団体の外へ影響が漏れないようにするため。
             */
            eq(groupInvitationTable.groupId, groupId),
            // 承諾済み・取り消し済みの招待を蒸し返さない
            eq(groupInvitationTable.status, InvitationStatus.Pending),
          ),
        )
        .returning({ id: groupInvitationTable.id }),
      databaseError("取り消し"),
    ).map((rows) => rows.length);

  const findById = (invitationId: string): ResultAsync<Invitation | null, GroupError> =>
    ResultAsync.fromPromise(
      db
        .select()
        .from(groupInvitationTable)
        .where(eq(groupInvitationTable.id, invitationId))
        .limit(1),
      databaseError("取得"),
    ).andThen((rows) => {
      const row = rows.at(0);
      if (row === undefined) {
        return ok(null);
      }
      return ok(toInvitation(row));
    });

  const accept = (input: AcceptInvitationInput): ResultAsync<string | null, GroupError> => {
    const statements = invitationAcceptStatements(db, input);
    return ResultAsync.fromPromise(
      db.batch([statements[0], statements[1]]),
      databaseError("承諾"),
    ).map((results) => {
      // 2 文目（条件付き UPDATE）の RETURNING。0 行なら承諾できる招待が無かった
      const acceptedRows = results[1] as { groupId: string }[];
      return acceptedRows.at(0)?.groupId ?? null;
    });
  };

  const reject = (input: RejectInvitationInput): ResultAsync<number, GroupError> =>
    ResultAsync.fromPromise(
      db
        .update(groupInvitationTable)
        .set({ status: InvitationStatus.Rejected })
        .where(
          and(
            eq(groupInvitationTable.id, input.invitationId),
            // 承諾済み・取り消し済みの招待を蒸し返さない
            eq(groupInvitationTable.status, InvitationStatus.Pending),
            // 招待メールを転送されただけの人が辞退できないよう、宛先本人に限る（COND-011）
            eq(groupInvitationTable.email, input.email),
            gt(groupInvitationTable.expiresAt, input.now),
          ),
        )
        .returning({ id: groupInvitationTable.id }),
      databaseError("辞退"),
    ).map((rows) => rows.length);

  return { findPendingByGroupAndEmail, create, cancel, findById, accept, reject };
};
