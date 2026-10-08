import { errAsync, ok, safeTry, type ResultAsync } from "neverthrow";

import { AuditLogAction, type AuditLogDraft } from "~/domain/audit-log";
import type { GroupError } from "~/domain/group";
import type { InvitationRepository } from "~/domain/invitation";
import { toInvitationRejectChanges } from "~/domain/invitation/audit-log";
import { normalizeInvitationEmail } from "~/domain/invitation/invitation-email";
import { invitationNotFound } from "./_shared/invitation-visibility";

export interface RejectInvitationDeps {
  readonly invitationRepository: InvitationRepository;
}

export interface RejectInvitationArgs {
  readonly invitationId: string;
  /** 操作者のユーザーID。操作履歴（INFO-008）の actorId に入る */
  readonly actorUserId: string;
  /** ログイン中の人のメールアドレス（未正規化） */
  readonly actorEmail: string;
  readonly now: Date;
}

/**
 * 招待を辞退するユースケース（UC-022 / SCR-016）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. invitationId を trim し、空なら DB を引かずに invitationNotFound() を返す。
 * 2. 事前 SELECT による招待情報の取得（COND-013）:
 *    操作履歴に必要な招待の属性（groupId, email, role）を取得する。
 *    招待の作成後に email や role は変わらないため、事前に読んでも属性の食い違いは起きない。
 *    なお「辞退できる状態か（期限・状態・宛先）」の厳密な判定は従来どおり UPDATE の WHERE 条件が担当する。
 * 3. invitationRepository.reject を呼び出して条件付き UPDATE と操作履歴記録を実行する。
 * 4. 辞退件数が 0 件の場合は invitationNotFound() を返し、成功時は null を返す。
 *
 * 事前に読んだ招待では判定せず、宛先違いも `InvitationNotVisible` と見分けない。
 * 理由は `acceptInvitationUseCase` と同じ。
 */
export const rejectInvitationUseCase = (
  deps: RejectInvitationDeps,
  args: RejectInvitationArgs,
): ResultAsync<null, GroupError> =>
  safeTry(async function* () {
    const invitationId = args.invitationId.trim();

    // 1. 空文字なら DB を引かずに終了（存在秘匿）
    if (invitationId === "") {
      return errAsync(invitationNotFound("辞退する招待の ID が空である。"));
    }

    // 2. 事前 SELECT: 操作履歴に必要な招待属性を取得する
    const invitation = yield* deps.invitationRepository.findById(invitationId);
    if (invitation === null) {
      return errAsync(
        invitationNotFound(
          "辞退できる招待が無かった（無い・期限切れ・承諾待ちではない・宛先違いのどれか）。",
        ),
      );
    }

    const normalizedEmail = normalizeInvitationEmail(args.actorEmail);

    const auditLog: AuditLogDraft = {
      occurredAt: args.now,
      actorId: args.actorUserId,
      actedAsStaff: false,
      action: AuditLogAction.InvitationDecline,
      targetId: invitation.id,
      groupId: invitation.groupId,
      changes: toInvitationRejectChanges(invitation.email, invitation.role),
    };

    // 3. 条件付き UPDATE による辞退と操作履歴記録を実行
    const rejectedCount = yield* deps.invitationRepository.reject(
      {
        invitationId,
        email: normalizedEmail,
        now: args.now,
      },
      auditLog,
    );

    // 4. 辞退できた行数が 0 件なら、対象の招待が無かったか条件不一致
    if (rejectedCount === 0) {
      return errAsync(
        invitationNotFound(
          "辞退できる招待が無かった（無い・期限切れ・承諾待ちではない・宛先違いのどれか）。",
        ),
      );
    }

    return ok(null);
  });
