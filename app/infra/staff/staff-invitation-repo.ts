import { and, desc, eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import { staffInvitationTable } from "~/db/schema";
import { InvitationStatus } from "~/domain/invitation";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import {
  type CreateStaffInvitationInput,
  type CreateStaffInvitationOutcome,
  type StaffError,
  StaffErrorCode,
  type StaffInvitation,
  type StaffInvitationRepository,
} from "~/domain/staff";
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
  ): ResultAsync<CreateStaffInvitationOutcome, StaffError> => {
    const insertQuery = db.insert(staffInvitationTable).values({
      id: input.id,
      email: input.email,
      status: InvitationStatus.Pending,
      expiresAt: input.expiresAt,
      createdAt: input.createdAt,
      inviterId: input.inviterId,
    });

    if (mailDrafts.length === 0) {
      return ResultAsync.fromPromise(insertQuery, databaseError("作成")).map(() => ({
        enqueuedMailIds: [],
      }));
    }

    const outbox = mailOutboxInserts(db, mailDrafts);
    return ResultAsync.fromPromise(
      db.batch([insertQuery, ...outbox.statements]),
      databaseError("作成および通知メールの登録"),
    ).map(() => ({
      enqueuedMailIds: outbox.ids,
    }));
  };

  const cancel = (invitationId: string): ResultAsync<number, StaffError> =>
    ResultAsync.fromPromise(
      db
        .update(staffInvitationTable)
        .set({ status: InvitationStatus.Canceled })
        .where(
          and(
            eq(staffInvitationTable.id, invitationId),
            eq(staffInvitationTable.status, InvitationStatus.Pending),
          ),
        )
        .returning({ id: staffInvitationTable.id }),
      databaseError("取り消し"),
    ).map((rows) => rows.length);

  return { findPendingByEmail, create, cancel };
};
