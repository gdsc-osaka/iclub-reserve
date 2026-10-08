import { createId } from "@paralleldrive/cuid2";
import { errAsync, ok, safeTry, type ResultAsync } from "neverthrow";

import { AuditLogAction, type AuditLogDraft } from "~/domain/audit-log";
import type { GroupError } from "~/domain/group";
import type { InvitationRepository } from "~/domain/invitation";
import { toInvitationAcceptChanges } from "~/domain/invitation/audit-log";
import { normalizeInvitationEmail } from "~/domain/invitation/invitation-email";
import { invitationNotFound } from "./_shared/invitation-visibility";

export interface AcceptInvitationDeps {
  readonly invitationRepository: InvitationRepository;
}

export interface AcceptInvitationArgs {
  readonly invitationId: string;
  readonly actorUserId: string;
  /** ログイン中の人のメールアドレス（未正規化） */
  readonly actorEmail: string;
  readonly now: Date;
}

export interface AcceptInvitationResult {
  /** 承諾した結果メンバーになった団体。承諾後の遷移先に使う */
  readonly groupId: string;
}

/**
 * 招待を承諾するユースケース（UC-022 / SCR-016）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. invitationId を trim し、空なら DB を引かずに invitationNotFound() を返す。
 * 2. 事前 SELECT による招待情報の取得（COND-013）:
 *    操作履歴に必要な招待の属性（groupId, email, role）を取得する。
 *    招待の作成後に email や role は変わらないため、事前に読んでも属性の食い違いは起きない。
 *    なお「承諾できる状態か（期限・状態・宛先）」の厳密な判定は従来どおり UPDATE の WHERE 条件が担当する。
 * 3. invitationRepository.accept を呼び出して条件付き更新とメンバー作成、操作履歴記録を 1 つの batch で実行する。
 * 4. 承諾対象が見つからず null が返った場合は invitationNotFound() を返し、成功時は groupId を返す。
 *
 * 【事前に読んだ招待で判定しない理由】
 * 事前の SELECT は、操作履歴に載せる値を得るためだけに使う。承諾できるかは判定しない。
 * 読んでから書くまでの間に、別の管理者が取り消したり本人が二重に送信したりして状態が変わりうる。
 * 判定を UPDATE の条件に畳み込んでおけば、書く瞬間の行で判定されるので、この競合は原理的に起きない。
 *
 * 【宛先違いを `InvitationNotVisible` と見分けない理由】
 * 判定を UPDATE の条件に畳み込んでいるので、どの条件で外れたのかは分からない。
 * 事前に読んだ招待で見分けると、判定を 2 か所に持つことになり、上の利点を失う。
 * 宛先違いは、承諾より前に画面を開いた時点（`getInvitationUseCase`）で `InvitationNotVisible` として残る。
 */
export const acceptInvitationUseCase = (
  deps: AcceptInvitationDeps,
  args: AcceptInvitationArgs,
): ResultAsync<AcceptInvitationResult, GroupError> =>
  safeTry(async function* () {
    const invitationId = args.invitationId.trim();

    // 1. 空文字なら DB を引かずに終了（存在秘匿）
    if (invitationId === "") {
      return errAsync(invitationNotFound("承諾する招待の ID が空である。"));
    }

    // 2. 事前 SELECT: 操作履歴に必要な招待属性を取得する
    const invitation = yield* deps.invitationRepository.findById(invitationId);
    if (invitation === null) {
      return errAsync(
        invitationNotFound(
          "承諾できる招待が無かった（無い・期限切れ・承諾待ちではない・宛先違いのどれか）。",
        ),
      );
    }

    const normalizedEmail = normalizeInvitationEmail(args.actorEmail);

    const auditLog: AuditLogDraft = {
      occurredAt: args.now,
      actorId: args.actorUserId,
      actedAsStaff: false,
      action: AuditLogAction.InvitationAccept,
      targetId: invitation.id,
      groupId: invitation.groupId,
      changes: toInvitationAcceptChanges(invitation.email, invitation.role),
    };

    // 3. 条件付き UPDATE とメンバー追加、操作履歴記録を実行する
    const groupId = yield* deps.invitationRepository.accept(
      {
        invitationId,
        email: normalizedEmail,
        userId: args.actorUserId,
        membershipId: createId(),
        now: args.now,
      },
      auditLog,
    );

    // 4. 対象の招待が無かった（条件に合致しなかった）場合
    if (groupId === null) {
      return errAsync(
        invitationNotFound(
          "承諾できる招待が無かった（無い・期限切れ・承諾待ちではない・宛先違いのどれか）。",
        ),
      );
    }

    return ok({ groupId });
  });
