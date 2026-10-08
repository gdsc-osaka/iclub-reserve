import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";

import { AuditLogAction, isActedAsStaff, type AuditLogDraft } from "~/domain/audit-log";
import type { GroupError } from "~/domain/group";
import { GroupAction, groupPermissions } from "~/domain/group";
import type { MembershipRepository } from "~/domain/membership";
import { MembershipRole } from "~/domain/membership";
import { toMembershipRoleChanges } from "~/domain/membership/audit-log";
import {
  ensureActorCan,
  groupNotFound,
  resolveGroupActorWithMembership,
  toGroupDatabaseError,
} from "./_shared/group-authorization";
import { ensureNotLastAdmin } from "./_shared/last-admin";
import { validateMembershipRole } from "./_shared/member-role";
import { memberNotFound, memberNotSpecified } from "./_shared/target-member";

export interface UpdateMemberRoleDeps {
  readonly membershipRepository: MembershipRepository;
}

export interface UpdateMemberRoleArgs {
  readonly groupId: string;
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。団体に所属していなくても操作できる */
  readonly isStaff: boolean;
  /** 役割を変える相手のユーザー ID */
  readonly targetUserId: string;
  /** フォームから届いた未検証の役割 */
  readonly role: string;
  readonly now: Date;
}

/**
 * メンバーの役割を変更するユースケース（REQ-018 / UC-012）。
 *
 * 【確かめる順序の理由】
 * 入力の検証（役割・対象）を認可より先に置いている。検証の結果は特定の団体に依存しないので、
 * 先に返しても団体の有無は漏れず、無効なリクエストで D1 を往復せずに済む。
 * 認可そのものの判断（事務局を通す・存在を秘匿する・足りない権限を伝える）は
 * resolveGroupActorWithMembership と ensureActorCan が持つ（COND-009 / COND-011）。
 *
 * 【同時実行の限界について】
 * Cloudflare D1 では複数クエリにまたがる厳密なトランザクションを張れないため、
 * 2 人の管理者が同時に互いを降格させた場合、極稀に管理者が 0 人になる余地が理論上残る。
 * また楽観ロックが無いため、読んでから書くまでに別の人が変えると記録の変更前が実際とずれることがある。
 * それでもシステム全体の管理権限を持つ事務局スタッフ（COND-009）が役割を復旧できるので、
 * 過剰な排他制御は行わず、この割り切りを許容している。
 */
export const updateMemberRoleUseCase = (
  deps: UpdateMemberRoleDeps,
  args: UpdateMemberRoleArgs,
): ResultAsync<null, GroupError> =>
  safeTry(async function* () {
    // 空文字や空白だけの ID は、DB へ問い合わせずに打ち切る（存在秘匿）
    const groupId = args.groupId.trim();
    if (groupId === "") return errAsync(groupNotFound());

    const nextRole = yield* validateMembershipRole(args.role);

    const targetUserId = args.targetUserId.trim();
    if (targetUserId === "") return errAsync(memberNotSpecified());

    const actor = yield* resolveGroupActorWithMembership(deps, {
      groupId,
      actorUserId: args.actorUserId,
      isStaff: args.isStaff,
    });
    yield* ensureActorCan(actor, GroupAction.UpdateMemberRole);

    const target = yield* deps.membershipRepository
      .findByGroupAndUser(groupId, targetUserId)
      .mapErr(toGroupDatabaseError);
    if (target === null) return errAsync(memberNotFound());

    // 役割が変わっていない場合は業務データも記録も書かずに成功（COND-013）
    if (target.role === nextRole) {
      return okAsync(null);
    }

    yield* ensureNotLastAdmin(
      deps,
      groupId,
      {
        targetIsAdmin: target.role === MembershipRole.Admin,
        targetStaysAdmin: nextRole === MembershipRole.Admin,
      },
      "管理者が 0 人になるため、最後の管理者は降格できません。先に別のメンバーを管理者にしてください。",
    );

    const actedAsStaff = isActedAsStaff(groupPermissions, actor, GroupAction.UpdateMemberRole);

    const auditLog: AuditLogDraft = {
      occurredAt: args.now,
      actorId: args.actorUserId,
      actedAsStaff,
      action: AuditLogAction.MembershipChangeRole,
      targetId: target.id,
      groupId,
      changes: toMembershipRoleChanges(targetUserId, target.role, nextRole),
    };

    const updatedCount = yield* deps.membershipRepository
      .updateRole({ groupId, userId: targetUserId, role: nextRole, updatedAt: args.now }, auditLog)
      .mapErr(toGroupDatabaseError);
    // 存在は確認済みだが、そこから更新までの間に別の操作で外されていることがある
    if (updatedCount === 0) return errAsync(memberNotFound());

    return okAsync(null);
  });
