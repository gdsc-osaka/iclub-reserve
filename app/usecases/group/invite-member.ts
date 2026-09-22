import { createId } from "@paralleldrive/cuid2";
import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";

import type { GroupError, GroupRepository } from "~/domain/group";
import { GroupAction, GroupErrorCode } from "~/domain/group";
import {
  invitationExpiresAt,
  type CreateInvitationInput,
  type InvitationRepository,
} from "~/domain/invitation";
import { validateInvitationEmail } from "~/domain/invitation/invitation-email";
import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import { createInvitationMailDraft } from "~/domain/mail/invitation-mail";
import type { MembershipRepository } from "~/domain/membership";
import { requestImmediateDelivery } from "~/usecases/_shared/mail-delivery";
import { ensureGroupPermission, groupNotFound } from "./_shared/group-authorization";
import { validateMembershipRole } from "./_shared/member-role";

export interface InviteMemberDeps {
  readonly groupRepository: GroupRepository;
  readonly membershipRepository: MembershipRepository;
  readonly invitationRepository: InvitationRepository;
  /** outbox に積んだメールの即時配送を依頼する先（ADR-002 決定 1） */
  readonly mailOutboxNotifier: MailOutboxNotifier;
}

export interface InviteMemberArgs {
  readonly groupId: string;
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。団体に所属していなくても操作できる */
  readonly isStaff: boolean;
  /** フォームから届いた未検証のメールアドレス */
  readonly email: string;
  /** フォームから届いた未検証の役割 */
  readonly role: string;
  readonly now: Date;
  /** 承諾リンクを組み立てるための、このアプリの絶対 URL の土台 */
  readonly appBaseUrl: string;
}

export interface InviteMemberResult {
  readonly invitationId: string;
}

/**
 * 団体へメンバーを招待するユースケース（REQ-017 / UC-011 / EVT-014）。
 *
 * 【確かめる順序の理由】
 * 入力の検証（メールアドレス・役割）を認可より先に置いている。検証の結果は特定の団体に
 * 依存しないので、先に返しても団体の有無は漏れず、無効なリクエストで D1 を往復せずに済む。
 * 認可そのものの判断（事務局を通す・存在を秘匿する・足りない権限を伝える）は
 * ensureGroupPermission が持つ（COND-009 / COND-011）。
 *
 * 逆に団体の取得は認可より後に置く。先に引くと、存在する団体のときだけ往復が 1 回増え、
 * 応答時間の差から団体の存在を推測されうる。
 *
 * 【同時実行の限界について】
 * 2 人の管理者が同時に同じ宛先へ招待すると、承諾待ちの招待が 2 件できる余地がある
 * （D1 では確認と書き込みを 1 つのトランザクションに包めないため）。
 * どちらの招待からでも同じ団体に入れるだけで、害は小さく、どちらも取り消せるので、
 * ここでは排他制御を入れずに割り切る。
 */
export const inviteMemberUseCase = (
  deps: InviteMemberDeps,
  args: InviteMemberArgs,
): ResultAsync<InviteMemberResult, GroupError> =>
  safeTry(async function* () {
    // 空文字や空白だけの ID は、DB へ問い合わせずに打ち切る（存在秘匿）
    const groupId = args.groupId.trim();
    if (groupId === "") return errAsync(groupNotFound());

    const email = yield* validateInvitationEmail(args.email);
    const role = yield* validateMembershipRole(args.role);

    yield* ensureGroupPermission(deps, { ...args, groupId }, GroupAction.InviteMember);

    // 団体名はメールの本文に載せるために引く
    const group = yield* deps.groupRepository.findById(groupId);

    const pending = yield* deps.invitationRepository.findPendingByGroupAndEmail(groupId, email);
    if (pending !== null && pending.expiresAt.getTime() > args.now.getTime()) {
      return errAsync<never, GroupError>({
        code: GroupErrorCode.GroupInvalidInput,
        message:
          "このメールアドレスには、すでに招待を送っています。取り消してから送り直してください。",
      });
    }

    // 期限切れの招待は妨げにしない。送り直せるよう、そのまま新規作成へ進む
    const invitationId = createId();
    const expiresAt = invitationExpiresAt(args.now);

    const mailDraft = createInvitationMailDraft({
      invitationId,
      groupName: group.name,
      email,
      role,
      expiresAt,
      appBaseUrl: args.appBaseUrl,
    });

    const createInput: CreateInvitationInput = {
      id: invitationId,
      groupId,
      email,
      role,
      inviterUserId: args.actorUserId,
      expiresAt,
      createdAt: args.now,
    };

    // 招待の INSERT と outbox への INSERT は同じ batch で不可分に実行される（ADR-002 決定 3）
    const outcome = yield* deps.invitationRepository.create(createInput, [mailDraft]);
    requestImmediateDelivery(deps.mailOutboxNotifier, outcome.enqueuedMailIds);

    return okAsync({ invitationId });
  });
