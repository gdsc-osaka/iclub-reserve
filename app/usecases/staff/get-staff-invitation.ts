import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";

import { InvitationUnavailableReason, invitationUnavailableReason } from "~/domain/invitation";
import { normalizeInvitationEmail } from "~/domain/invitation/invitation-email";
import type { StaffError, StaffInvitationRepository } from "~/domain/staff";
import {
  staffInvitationNotFound,
  staffInvitationNotVisible,
} from "./_shared/staff-invitation-visibility";

export interface GetStaffInvitationDeps {
  readonly staffInvitationRepository: StaffInvitationRepository;
}

export interface GetStaffInvitationArgs {
  readonly invitationId: string;
  /** ログイン中の人のメールアドレス（未正規化） */
  readonly actorEmail: string;
  /** 有効期限を判定する基準時刻 */
  readonly now: Date;
}

/**
 * 承諾画面（SCR-020）に出す 1 つ分のデータ。
 */
export interface StaffInvitationView {
  readonly invitationId: string;
  readonly expiresAt: Date;
}

/**
 * 事務局招待の承諾画面（SCR-020）に表示する招待情報を取得するユースケース（UC-027）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. invitationId を trim し、空なら DB を引かずに staffInvitationNotFound() を返す。
 * 2. findById で招待を引く。null なら staffInvitationNotFound() を返す。
 * 3. 状態・期限・宛先の不整合を invitationUnavailableReason で判定する。
 *    - 承諾待ち以外の状態、有効期限切れ（期限ちょうどは切れている扱い）なら staffInvitationNotFound() を返す。
 *    - 宛先違いなら staffInvitationNotVisible() を返す。
 *    利用者への応答はどちらも同じ 404 になるが、揃えるのは画面の側で、ここでは宛先違いとして正直に返す（ADR-004 決定 4）。
 */
export const getStaffInvitationUseCase = (
  deps: GetStaffInvitationDeps,
  args: GetStaffInvitationArgs,
): ResultAsync<StaffInvitationView, StaffError> =>
  safeTry(async function* () {
    const invitationId = args.invitationId.trim();

    // 1. 空文字なら DB を引かずに終了（存在秘匿）
    if (invitationId === "") {
      return errAsync(staffInvitationNotFound("事務局招待 ID が空である。"));
    }

    // 2. 招待を取得
    const invitation = yield* deps.staffInvitationRepository.findById(invitationId);
    if (invitation === null) {
      return errAsync(staffInvitationNotFound(`事務局招待 ${invitationId} が見つからない。`));
    }

    // 3. 状態・期限・宛先を判定
    const unavailableReason = invitationUnavailableReason(
      invitation,
      normalizeInvitationEmail(args.actorEmail),
      args.now,
    );

    if (unavailableReason === InvitationUnavailableReason.NotPending) {
      return errAsync(
        staffInvitationNotFound(
          `事務局招待 ${invitation.id} は承諾待ちではない (${invitation.status})。`,
        ),
      );
    }

    if (unavailableReason === InvitationUnavailableReason.Expired) {
      return errAsync(
        staffInvitationNotFound(`事務局招待 ${invitation.id} は有効期限が切れている。`),
      );
    }

    if (unavailableReason === InvitationUnavailableReason.NotAddressee) {
      return errAsync(staffInvitationNotVisible());
    }

    return okAsync({
      invitationId: invitation.id,
      expiresAt: invitation.expiresAt,
    });
  });
