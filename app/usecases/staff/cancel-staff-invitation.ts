import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";
import {
  StaffAction,
  type StaffError,
  StaffErrorCode,
  type StaffInvitationRepository,
} from "~/domain/staff";
import { ensureStaffPermission } from "./_shared/staff-authorization";

export interface CancelStaffInvitationDeps {
  readonly staffInvitationRepository: StaffInvitationRepository;
}

export interface CancelStaffInvitationArgs {
  readonly actorUserId: string;
  readonly isStaff: boolean;
  /** 取り消す事務局招待の ID */
  readonly invitationId: string;
}

/**
 * 承諾待ちの事務局招待を取り消すユースケース（REQ-041 / UC-026）。
 *
 * 【事前 SELECT による存在確認を行わない理由】
 * 条件付きの UPDATE 1 回で「存在して承諾待ちなら取り消す・無ければ 0 件」が判定できるため、
 * 事前 SELECT を省くことで D1 への往復レイテンシを 1 回削減できる。
 * さらに、「読んでから書く」までの間に他人が先に取り消す・承諾するといった競合が原理的に起きない。
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

    // 3. 招待を取り消す
    const canceledCount = yield* deps.staffInvitationRepository.cancel(invitationId);
    if (canceledCount === 0) {
      return errAsync<never, StaffError>({
        code: StaffErrorCode.InvitationNotFound,
        message: `対象の事務局招待 ${invitationId} が見つからない。すでに取り消されたか、承諾された可能性がある。`,
        userMessage: "対象の招待が見つかりませんでした。画面を読み込み直してください。",
      });
    }

    return okAsync(null);
  });
