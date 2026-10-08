import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";
import {
  StaffAction,
  type StaffError,
  StaffErrorCode,
  type StaffInvitationRepository,
} from "~/domain/staff";
import { toStaffRoleCancelInvitationAuditLog } from "~/domain/staff/audit-log";
import { ensureStaffPermission } from "./_shared/staff-authorization";

export interface CancelStaffInvitationDeps {
  readonly staffInvitationRepository: StaffInvitationRepository;
}

export interface CancelStaffInvitationArgs {
  readonly actorUserId: string;
  readonly isStaff: boolean;
  /** 取り消す事務局招待の ID */
  readonly invitationId: string;
  readonly now: Date;
}

/**
 * 承諾待ちの事務局招待を取り消すユースケース（REQ-041 / UC-026）。
 *
 * 【変更前の状態の取得と条件付き UPDATE】
 * 操作履歴に記録する変更前のメールアドレスを取得するため、事前に findById を呼ぶ（COND-013）。
 * 招待のメールアドレスは作成後に変更されないため、事前に読んでも値の不整合は起きない。
 * 承諾待ちかどうかの厳密な判定は、従来どおりリポジトリの条件付き UPDATE に委ねる。
 */
export const cancelStaffInvitationUseCase = (
  deps: CancelStaffInvitationDeps,
  args: CancelStaffInvitationArgs,
): ResultAsync<null, StaffError> =>
  safeTry(async function* () {
    // 1. 認可判定
    yield* ensureStaffPermission({ isStaff: args.isStaff }, StaffAction.CancelInvitation);

    // 2. 招待 ID の検証
    const invitationId = args.invitationId.trim();
    if (invitationId === "") {
      return errAsync<never, StaffError>({
        code: StaffErrorCode.InvalidInput,
        message: "取り消す事務局招待の ID が空である。",
        userMessage: "取り消す招待が指定されていません。",
      });
    }

    // 3. 変更前の状態（email）を事前に取得
    // 楽観ロックが無いため、読んでから書くまでに別の人が変えると記録の変更前がずれる可能性があるが、
    // 招待の email は作成後に変わらないため食い違いは起きない（COND-013）。
    const existing = yield* deps.staffInvitationRepository.findById(invitationId);
    if (existing === null) {
      return errAsync<never, StaffError>({
        code: StaffErrorCode.InvitationNotFound,
        message: `対象の事務局招待 ${invitationId} が見つからない。すでに取り消されたか、承諾された可能性がある。`,
        userMessage: "対象の招待が見つかりませんでした。画面を読み込み直してください。",
      });
    }

    const auditLog = toStaffRoleCancelInvitationAuditLog(
      invitationId,
      existing.email,
      args.actorUserId,
      args.now,
    );

    // 4. 招待を取り消す
    const canceledCount = yield* deps.staffInvitationRepository.cancel(invitationId, auditLog);
    if (canceledCount === 0) {
      return errAsync<never, StaffError>({
        code: StaffErrorCode.InvitationNotFound,
        message: `対象の事務局招待 ${invitationId} が見つからない。すでに取り消されたか、承諾された可能性がある。`,
        userMessage: "対象の招待が見つかりませんでした。画面を読み込み直してください。",
      });
    }

    return okAsync(null);
  });
