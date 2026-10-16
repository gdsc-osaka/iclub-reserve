import { and, asc, eq, gt } from "drizzle-orm";
import { ok, ResultAsync, safeTry } from "neverthrow";

import { staffInvitationTable, user } from "~/db/schema";
import { InvitationStatus } from "~/domain/invitation";
import type { Database } from "~/infra/db";
import { ensureStaff } from "../_shared/staff";
import { QueryErrorCode, type QueryError } from "../error";

/** 事務局一覧に並ぶメンバー 1 件分のデータ */
export interface StaffMemberView {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
}

/** 承諾待ちの事務局招待 1 件分のデータ */
export interface StaffPendingInvitationView {
  readonly id: string;
  readonly email: string;
  readonly expiresAt: Date;
}

/** 事務局管理画面（SCR-019）に表示するデータ */
export interface StaffManagementView {
  readonly members: readonly StaffMemberView[];
  readonly pendingInvitations: readonly StaffPendingInvitationView[];
}

export interface FindStaffManagementArgs {
  readonly isStaff: boolean;
  /** 招待の期限切れを判定する基準の時刻 */
  readonly now: Date;
}

/**
 * 事務局管理画面（SCR-019）のデータを取得する。
 *
 * 事務局スタッフ一覧（氏名昇順、同名は ID 昇順）と、
 * 承諾待ちの事務局招待一覧（有効期限昇順、同期限は ID 昇順）を取得する。
 *
 * 【認可と可視範囲】
 * 事務局スタッフ（isStaff: true）のみに許可する（COND-009）。
 * 一般利用者が開こうとした場合は、DB 問い合わせを行う前に即座に FORBIDDEN を返す。
 *
 * 【承諾待ちの招待】
 * 期限切れは状態として持たず、承諾待ちのまま expires_at で判定する（STATE-003）。
 * 期限を過ぎた招待はもう承諾できないので、承諾待ちの一覧には出さない。
 * 団体管理画面（SCR-007、`getGroupManagementUseCase`）と同じ扱いにそろえる。
 */
export const findStaffManagement = (
  db: Database,
  args: FindStaffManagementArgs,
): ResultAsync<StaffManagementView, QueryError> =>
  safeTry(async function* () {
    yield* ensureStaff(args.isStaff, "事務局ではないユーザーが事務局管理画面を開こうとした。");

    const membersQuery = db
      .select({
        userId: user.id,
        name: user.name,
        email: user.email,
      })
      .from(user)
      .where(eq(user.is_staff, true))
      .orderBy(asc(user.name), asc(user.id));

    const pendingInvitationsQuery = db
      .select({
        id: staffInvitationTable.id,
        email: staffInvitationTable.email,
        expiresAt: staffInvitationTable.expiresAt,
      })
      .from(staffInvitationTable)
      .where(
        and(
          eq(staffInvitationTable.status, InvitationStatus.Pending),
          gt(staffInvitationTable.expiresAt, args.now),
        ),
      )
      .orderBy(asc(staffInvitationTable.expiresAt), asc(staffInvitationTable.id));

    const [members, pendingInvitations] = yield* ResultAsync.fromPromise(
      Promise.all([membersQuery, pendingInvitationsQuery]),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "事務局管理画面データの取得に失敗しました。",
        cause: error,
      }),
    );

    return ok({ members, pendingInvitations });
  });
