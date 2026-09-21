import { and, eq } from "drizzle-orm";
import { ok, ResultAsync } from "neverthrow";
import { invitation } from "~/db/schema";
import { GroupErrorCode, type GroupError } from "~/domain/group";
import {
  InvitationStatus,
  type CreateInvitationInput,
  type CreateInvitationOutcome,
  type Invitation,
  type InvitationRepository,
} from "~/domain/invitation";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import type { Database } from "../db";
import { mailOutboxInserts } from "../mail/mail-outbox-writes";
import { toInvitation } from "./invitation-converter";

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
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, groupId),
            eq(invitation.email, email),
            eq(invitation.status, InvitationStatus.Pending),
          ),
        )
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
    const insertInvitationQuery = db.insert(invitation).values({
      id: input.id,
      organizationId: input.groupId,
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
        .update(invitation)
        .set({ status: InvitationStatus.Canceled })
        .where(
          and(
            eq(invitation.id, invitationId),
            /*
             * 他団体の招待を取り消せないよう、必ず団体 ID で絞る。
             * 操作者が意図しない団体の招待 ID を指定しても、団体の外へ影響が漏れないようにするため。
             */
            eq(invitation.organizationId, groupId),
            // 承諾済み・取り消し済みの招待を蒸し返さない
            eq(invitation.status, InvitationStatus.Pending),
          ),
        )
        .returning({ id: invitation.id }),
      databaseError("取り消し"),
    ).map((rows) => rows.length);

  return { findPendingByGroupAndEmail, create, cancel };
};
