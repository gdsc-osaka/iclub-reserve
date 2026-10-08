import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";

import { normalizeInvitationEmail } from "~/domain/invitation/invitation-email";
import type { StaffError, StaffInvitationRepository } from "~/domain/staff";
import { toStaffRoleDeclineAuditLog } from "~/domain/staff/audit-log";
import { staffInvitationNotFound } from "./_shared/staff-invitation-visibility";

export interface RejectStaffInvitationDeps {
  readonly staffInvitationRepository: StaffInvitationRepository;
}

export interface RejectStaffInvitationArgs {
  readonly invitationId: string;
  readonly actorUserId: string;
  /** ログイン中の人のメールアドレス（未正規化） */
  readonly actorEmail: string;
  readonly now: Date;
}

/**
 * 事務局招待を辞退するユースケース（UC-027 / SCR-020）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. invitationId を trim し、空なら DB を引かずに staffInvitationNotFound() を返す。
 * 2. staffInvitationRepository.reject を呼び出して条件付き UPDATE を実行する。
 *    操作履歴も同じ条件で直前に書き込む（COND-013）。
 * 3. 辞退件数が 0 件の場合は staffInvitationNotFound() を返し、成功時は null を返す。
 *
 * 【事前 SELECT による存在確認を行わない理由】
 * 条件付き UPDATE 1 文で「辞退できるなら辞退する・できなければ 0 件」が判定できるため、
 * 事前 SELECT を行わない。D1 への往復レイテンシを 1 回削減でき、
 * 読んでから書くまでの競合も原理的に防止できる。
 * 同じ理由で、宛先違いを `StaffErrorCode.InvitationNotVisible` と見分けない（`acceptStaffInvitationUseCase` を参照）。
 */
export const rejectStaffInvitationUseCase = (
  deps: RejectStaffInvitationDeps,
  args: RejectStaffInvitationArgs,
): ResultAsync<null, StaffError> =>
  safeTry(async function* () {
    const invitationId = args.invitationId.trim();

    // 1. 空文字なら DB を引かずに終了（存在秘匿）
    if (invitationId === "") {
      return errAsync(staffInvitationNotFound("辞退する事務局招待の ID が空である。"));
    }

    const normalizedEmail = normalizeInvitationEmail(args.actorEmail);
    const auditLog = toStaffRoleDeclineAuditLog(
      invitationId,
      normalizedEmail,
      args.actorUserId,
      args.now,
    );

    // 2. 条件付き UPDATE による辞退を実行（事前 SELECT は行わない）
    const rejectedCount = yield* deps.staffInvitationRepository.reject(
      {
        invitationId,
        email: normalizedEmail,
        now: args.now,
      },
      auditLog,
    );

    // 3. 辞退できた行数が 0 件なら、対象の招待が無かったか条件不一致
    if (rejectedCount === 0) {
      return errAsync(
        staffInvitationNotFound(
          "辞退できる招待が無かった（無い・期限切れ・承諾待ちではない・宛先違いのどれか）。",
        ),
      );
    }

    return okAsync(null);
  });
