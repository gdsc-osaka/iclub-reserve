import { createId } from "@paralleldrive/cuid2";
import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";
import { invitationExpiresAt } from "~/domain/invitation";
import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import { createStaffInvitationMailDraft } from "~/domain/mail/staff-invitation-mail";
import {
  StaffAction,
  type StaffError,
  StaffErrorCode,
  StaffField,
  type StaffInvitationRepository,
  type StaffMemberRepository,
  validateStaffInvitationEmail,
} from "~/domain/staff";
import { toStaffRoleInviteAuditLog } from "~/domain/staff/audit-log";
import { requestImmediateDelivery } from "~/usecases/_shared/mail-delivery";
import { ensureStaffPermission } from "./_shared/staff-authorization";

export interface InviteStaffDeps {
  readonly staffMemberRepository: StaffMemberRepository;
  readonly staffInvitationRepository: StaffInvitationRepository;
  readonly mailOutboxNotifier: MailOutboxNotifier;
}

export interface InviteStaffArgs {
  readonly actorUserId: string;
  readonly isStaff: boolean;
  readonly email: string;
  readonly now: Date;
  readonly appBaseUrl: string;
}

export interface InviteStaffResult {
  readonly invitationId: string;
}

/**
 * 事務局へ新しいメンバーを招待するユースケース（REQ-041 / UC-026 / EVT-015）。
 *
 * 【同時実行の限界について】
 * 2 人の事務局が同時に同じ宛先へ招待した場合、承諾待ちの招待が 2 件できる余地がある
 * （D1 では確認と書き込みを 1 つのトランザクションに包めないため）。
 * どちらの招待からでも事務局になれるだけで害は小さく、どちらも取り消せるので、
 * ここでは排他制御を入れずに割り切る。
 */
export const inviteStaffUseCase = (
  deps: InviteStaffDeps,
  args: InviteStaffArgs,
): ResultAsync<InviteStaffResult, StaffError> =>
  safeTry(async function* () {
    // 1. 認可判定
    yield* ensureStaffPermission({ isStaff: args.isStaff }, StaffAction.Invite);

    // 2. 宛先メールアドレスの検証・正規化
    const normalizedEmail = yield* validateStaffInvitationEmail(args.email);

    // 3. 宛先がすでに事務局かどうかの確認
    const existingStaff = yield* deps.staffMemberRepository.findStaffByEmail(normalizedEmail);
    if (existingStaff !== null) {
      return errAsync<never, StaffError>({
        code: StaffErrorCode.InvalidInput,
        field: StaffField.Email,
        // 宛先のアドレスは埋め込まない（ADR-004 決定 9）
        message: `宛先ユーザー ${existingStaff.id} はすでに事務局である。`,
        userMessage: "このメールアドレスの方は、すでに事務局です。",
      });
    }

    // 4. 承諾待ちかつ有効期限内の招待が既にあるか確認
    const pending = yield* deps.staffInvitationRepository.findPendingByEmail(normalizedEmail);
    if (pending !== null && pending.expiresAt.getTime() > args.now.getTime()) {
      return errAsync<never, StaffError>({
        code: StaffErrorCode.InvalidInput,
        field: StaffField.Email,
        message: `承諾待ちの招待 ${pending.id} と宛先が重なっている。`,
        userMessage:
          "このメールアドレスには、すでに招待を送っています。取り消してから送り直してください。",
      });
    }

    // 5. 招待の作成とメール下書きの生成
    const invitationId = createId();
    const expiresAt = invitationExpiresAt(args.now);

    const mailDraft = createStaffInvitationMailDraft({
      invitationId,
      email: normalizedEmail,
      expiresAt,
      appBaseUrl: args.appBaseUrl,
    });

    const auditLog = toStaffRoleInviteAuditLog(
      invitationId,
      normalizedEmail,
      args.actorUserId,
      args.now,
    );

    const outcome = yield* deps.staffInvitationRepository.create(
      {
        id: invitationId,
        email: normalizedEmail,
        expiresAt,
        inviterId: args.actorUserId,
        createdAt: args.now,
      },
      [mailDraft],
      auditLog,
    );

    // 6. 即時配送の依頼
    requestImmediateDelivery(deps.mailOutboxNotifier, outcome.enqueuedMailIds);

    return okAsync({ invitationId });
  });
