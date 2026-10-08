import { errAsync, okAsync, ResultAsync, safeTry } from "neverthrow";

import { AuditLogAction, isActedAsStaff, type AuditLogDraft } from "~/domain/audit-log";
import type { GroupError } from "~/domain/group";
import { GroupAction, GroupErrorCode, groupPermissions } from "~/domain/group";
import type { InvitationRepository } from "~/domain/invitation";
import { toInvitationCancelChanges } from "~/domain/invitation/audit-log";
import type { MembershipRepository } from "~/domain/membership";
import {
  ensureActorCan,
  groupNotFound,
  resolveGroupActorWithMembership,
} from "./_shared/group-authorization";

export interface CancelInvitationDeps {
  readonly membershipRepository: MembershipRepository;
  readonly invitationRepository: InvitationRepository;
}

export interface CancelInvitationArgs {
  readonly groupId: string;
  readonly actorUserId: string;
  readonly isStaff: boolean;
  /** 取り消す招待の ID */
  readonly invitationId: string;
  readonly now: Date;
}

/**
 * 承諾待ちの招待を取り消すユースケース（REQ-017 / UC-011）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. groupId のトリム検証:
 *    空文字または空白のみの場合は DB 問い合わせを行わず、即座に groupNotFound() を返す。
 * 2. invitationId のトリム検証:
 *    空文字または空白のみの場合は無効な入力として InvalidInput を返す。
 * 3. 認可判定（COND-009 / COND-011）:
 *    resolveGroupActorWithMembership と ensureActorCan に任せる。
 * 4. 事前 SELECT による招待情報の取得（COND-013）:
 *    操作履歴に必要な招待の属性（email, role）を取得する。
 *    招待の作成後に email や role は変わらないため、事前に読んでも属性の食い違いは起きない。
 *    なお「取り消せる状態か」の判定は従来どおり cancel の UPDATE 条件が担当する。
 * 5. 招待の取り消し実行（invitationRepository.cancel）:
 *    キャンセル件数が 0 件の場合は、既に別管理者にキャンセルされたか、または承諾済みであるため、
 *    InvitationNotFound を返す。
 */
export const cancelInvitationUseCase = (
  deps: CancelInvitationDeps,
  args: CancelInvitationArgs,
): ResultAsync<null, GroupError> =>
  safeTry(async function* () {
    const groupId = args.groupId.trim();
    if (groupId === "") {
      return errAsync(groupNotFound());
    }

    const invitationId = args.invitationId.trim();
    if (invitationId === "") {
      return errAsync({
        code: GroupErrorCode.InvalidInput,
        message: "取り消す招待の ID が空である。",
        userMessage: "取り消す招待が指定されていません。",
      });
    }

    const actor = yield* resolveGroupActorWithMembership(deps, {
      groupId,
      actorUserId: args.actorUserId,
      isStaff: args.isStaff,
    });
    yield* ensureActorCan(actor, GroupAction.InviteMember);

    // 操作履歴の記録に必要な email, role を取得する
    const invitation = yield* deps.invitationRepository.findById(invitationId);
    if (invitation === null || invitation.groupId !== groupId) {
      return errAsync({
        code: GroupErrorCode.InvitationNotFound,
        message: "対象の招待が見つかりません。すでに取り消されたか、承諾された可能性があります。",
      });
    }

    const actedAsStaff = isActedAsStaff(groupPermissions, actor, GroupAction.InviteMember);

    const auditLog: AuditLogDraft = {
      occurredAt: args.now,
      actorId: args.actorUserId,
      actedAsStaff,
      action: AuditLogAction.InvitationCancel,
      targetId: invitation.id,
      groupId,
      changes: toInvitationCancelChanges(invitation.email, invitation.role),
    };

    const canceledCount = yield* deps.invitationRepository.cancel(groupId, invitationId, auditLog);
    if (canceledCount === 0) {
      return errAsync({
        code: GroupErrorCode.InvitationNotFound,
        message: "対象の招待が見つかりません。すでに取り消されたか、承諾された可能性があります。",
      });
    }

    return okAsync(null);
  });
