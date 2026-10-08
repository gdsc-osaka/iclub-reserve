import { and, desc, eq, exists, gt, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import { staffInvitationTable, user } from "~/db/schema";
import type { AuditLogDraft } from "~/domain/audit-log";
import { InvitationStatus, type RejectInvitationInput } from "~/domain/invitation";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import {
  type AcceptStaffInvitationInput,
  type CreateStaffInvitationInput,
  type CreateStaffInvitationOutcome,
  type StaffError,
  StaffErrorCode,
  type StaffInvitation,
  type StaffInvitationRepository,
} from "~/domain/staff";
import { auditLogInsert, guardedAuditLogInsert } from "../audit-log/audit-log-writes";
import type { Database } from "../db";
import { mailOutboxInserts } from "../mail/mail-outbox-writes";

const databaseError =
  (operation: string) =>
  (cause: unknown): StaffError => ({
    code: StaffErrorCode.DatabaseError,
    message: `事務局招待の${operation}に失敗しました。`,
    cause,
  });

const toStaffInvitation = (row: typeof staffInvitationTable.$inferSelect): StaffInvitation => ({
  id: row.id,
  email: row.email,
  status: row.status,
  expiresAt: row.expiresAt,
  inviterId: row.inviterId,
  createdAt: row.createdAt,
});

/**
 * 承諾・辞退できる招待かどうかを決める条件（COND-015）。
 *
 * 承諾の 2 文と辞退の 1 文で必ず同じものを使う。書き分けると食い違いに気付けず、
 * 画面に出ていない招待を古いフォームの再送信で辞退できてしまう、といったことが起きる。
 */
const respondableInvitation = (input: RejectInvitationInput) =>
  and(
    eq(staffInvitationTable.id, input.invitationId),
    // 取り消し済み・承諾済み・辞退済みの招待を蒸し返さない
    eq(staffInvitationTable.status, InvitationStatus.Pending),
    // 招待メールを転送されただけの人が応じられないよう、宛先本人に限る
    eq(staffInvitationTable.email, input.email),
    gt(staffInvitationTable.expiresAt, input.now),
  );

/**
 * 事務局招待の承諾時に `db.batch()` へ渡す 3 文を組み立てる。返す並びが実行順になる。
 *
 * 【3 文が同じ条件を見ることが安全性の要である】
 * `db.batch()` は中の文を無条件に全部実行する。そのため「招待は承諾できなかったのに
 * ユーザーが事務局になってしまう」ことを防ぐには、ユーザーを事務局にする文自身が
 * 「承諾できる招待か」を確かめる必要がある（EXISTS 句）。
 * 同様に、操作履歴の記録も同じ条件を確かめる（COND-013）。
 *
 * 【並び順の理由（UPDATE staffInvitationTable の直前に操作履歴を置く）】
 * 3 の招待ステータス更新を先に流すと、status が 'accepted' に変わるため、
 * 操作履歴の条件（`status = 'pending'` を含む acceptable）が偽になってしまう。
 * そのため、1 で招待が存在することを確認しつつユーザーの `is_staff` を更新し、
 * 続いて 2 で同じ条件で操作履歴を記録し、3 で招待を `accepted` に更新する。
 *
 * 【すでに事務局の人が承諾した場合】
 * すでに事務局の人（別の経路で先に事務局になった人）が承諾しても、
 * 1 は値（is_staff = true）が変わらないだけで害は無い。そのまま承諾済みにしてよい。
 */
export const staffInvitationAcceptStatements = (
  db: Database,
  input: AcceptStaffInvitationInput,
  auditLog: AuditLogDraft,
) => {
  const acceptable = respondableInvitation(input);

  const updateUser = db
    .update(user)
    .set({
      is_staff: true,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(user.id, input.userId),
        exists(
          db
            .select({ one: sql`1` })
            .from(staffInvitationTable)
            .where(acceptable),
        ),
      ),
    );

  const auditLogStatement = guardedAuditLogInsert(db, auditLog, {
    from: staffInvitationTable,
    where: acceptable,
  });

  const acceptInvitation = db
    .update(staffInvitationTable)
    .set({ status: InvitationStatus.Accepted })
    .where(acceptable)
    .returning({ id: staffInvitationTable.id });

  return [updateUser, auditLogStatement, acceptInvitation];
};

export const createStaffInvitationRepository = (db: Database): StaffInvitationRepository => {
  const findPendingByEmail = (email: string): ResultAsync<StaffInvitation | null, StaffError> =>
    ResultAsync.fromPromise(
      db
        .select()
        .from(staffInvitationTable)
        .where(
          and(
            eq(staffInvitationTable.email, email),
            eq(staffInvitationTable.status, InvitationStatus.Pending),
          ),
        )
        .orderBy(desc(staffInvitationTable.expiresAt))
        .limit(1),
      databaseError("取得"),
    ).map((rows) => {
      const row = rows.at(0);
      if (!row) {
        return null;
      }
      return toStaffInvitation(row);
    });

  const create = (
    input: CreateStaffInvitationInput,
    mailDrafts: readonly MailDraft[],
    auditLog: AuditLogDraft,
  ): ResultAsync<CreateStaffInvitationOutcome, StaffError> => {
    const insertQuery = db.insert(staffInvitationTable).values({
      id: input.id,
      email: input.email,
      status: InvitationStatus.Pending,
      expiresAt: input.expiresAt,
      createdAt: input.createdAt,
      inviterId: input.inviterId,
    });
    const auditLogStatement = auditLogInsert(db, auditLog);

    const outbox = mailOutboxInserts(db, mailDrafts);
    return ResultAsync.fromPromise(
      db.batch([insertQuery, auditLogStatement, ...outbox.statements]),
      databaseError("作成および通知メールの登録"),
    ).map(() => ({
      enqueuedMailIds: outbox.ids,
    }));
  };

  const cancel = (
    invitationId: string,
    auditLog: AuditLogDraft,
  ): ResultAsync<number, StaffError> => {
    const cancelCondition = and(
      eq(staffInvitationTable.id, invitationId),
      eq(staffInvitationTable.status, InvitationStatus.Pending),
    );
    const auditLogStatement = guardedAuditLogInsert(db, auditLog, {
      from: staffInvitationTable,
      where: cancelCondition,
    });
    const updateStatement = db
      .update(staffInvitationTable)
      .set({ status: InvitationStatus.Canceled })
      .where(cancelCondition)
      .returning({ id: staffInvitationTable.id });

    return ResultAsync.fromPromise(
      db.batch([auditLogStatement, updateStatement]),
      databaseError("取り消し"),
    ).map((results) => {
      const rows = results[1] as { id: string }[];
      return rows.length;
    });
  };

  const findById = (invitationId: string): ResultAsync<StaffInvitation | null, StaffError> =>
    ResultAsync.fromPromise(
      db
        .select()
        .from(staffInvitationTable)
        .where(eq(staffInvitationTable.id, invitationId))
        .limit(1),
      databaseError("取得"),
    ).map((rows) => {
      const row = rows.at(0);
      if (!row) {
        return null;
      }
      return toStaffInvitation(row);
    });

  const accept = (
    input: AcceptStaffInvitationInput,
    auditLog: AuditLogDraft,
  ): ResultAsync<boolean, StaffError> => {
    const statements = staffInvitationAcceptStatements(db, input, auditLog);
    return ResultAsync.fromPromise(
      db.batch([statements[0], statements[1], statements[2]]),
      databaseError("承諾"),
    ).map((results) => {
      const acceptedRows = results[2] as { id: string }[];
      return acceptedRows.length > 0;
    });
  };

  const reject = (
    input: RejectInvitationInput,
    auditLog: AuditLogDraft,
  ): ResultAsync<number, StaffError> => {
    const rejectCondition = respondableInvitation(input);
    const auditLogStatement = guardedAuditLogInsert(db, auditLog, {
      from: staffInvitationTable,
      where: rejectCondition,
    });
    const updateStatement = db
      .update(staffInvitationTable)
      .set({ status: InvitationStatus.Rejected })
      .where(rejectCondition)
      .returning({ id: staffInvitationTable.id });

    return ResultAsync.fromPromise(
      db.batch([auditLogStatement, updateStatement]),
      databaseError("辞退"),
    ).map((results) => {
      const rows = results[1] as { id: string }[];
      return rows.length;
    });
  };

  return { findPendingByEmail, create, cancel, findById, accept, reject };
};
