import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";

import { AuditLogAction, isActedAsStaff, type AuditLogDraft } from "~/domain/audit-log";
import {
  GroupAction,
  groupPermissions,
  type Group,
  type GroupError,
  type GroupRepository,
} from "~/domain/group";
import { toGroupNameUpdatedChanges } from "~/domain/group/audit-log";
import { validateGroupName } from "~/domain/group/group-name";
import type { MembershipRepository } from "~/domain/membership";
import { ensureActorCan, groupNotFound, resolveGroupActor } from "./_shared/group-authorization";

export interface UpdateGroupNameDeps {
  readonly groupRepository: GroupRepository;
  readonly membershipRepository: MembershipRepository;
}

export interface UpdateGroupNameArgs {
  readonly groupId: string;
  readonly actorUserId: string;
  /** 事務局の画面からの操作か（COND-030 の (1)） */
  readonly isStaff: boolean;
  /** フォームから届いた未検証の団体名 */
  readonly name: string;
  /** 更新日時として書き込む時刻 */
  readonly now: Date;
}

/**
 * 団体名を更新するユースケース（REQ-020 / UC-013）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. groupId のトリム検証:
 *    空文字または空白のみの場合は DB 問い合わせを行わず、即座に groupNotFound() を返す。
 * 2. 団体名のドメイン検証（validateGroupName）:
 *    認可判定（DB 問い合わせ）より前に実行する。入力値の検証は特定の団体に依存しないため、
 *    先に返しても団体の有無が外部に漏れることはない。無効な入力に対して無駄な DB 往復を
 *    確実に 1 回削減できる（Cloudflare D1 のレイテンシとコストの削減）。
 * 3. 認可判定と acted_as_staff（COND-012・COND-030 の (1)・(2)）:
 *    resolveGroupActor で画面に応じた Actor を組み立て、acted_as_staff を判定する。
 *    事務局の画面からの操作は所属を読まず acted_as_staff: true、利用者の画面からは所属を読んで acted_as_staff: false となる。
 * 4. 変更前の値と変わった項目が無いときの処理（COND-013）:
 *    `findById` で変更前の団体名を取得する。読んでから書くまでに別の人が変えると記録の変更前が
 *    実際とずれることがある（楽観ロックが無いため）。
 *    新旧の団体名が同じ場合は、業務データも操作履歴も書き込まずに成功を返す。
 */
export const updateGroupNameUseCase = (
  deps: UpdateGroupNameDeps,
  args: UpdateGroupNameArgs,
): ResultAsync<Group, GroupError> =>
  safeTry(async function* () {
    const groupId = args.groupId.trim();
    if (groupId === "") {
      return errAsync(groupNotFound());
    }

    const validatedName = yield* validateGroupName(args.name);

    const actor = yield* resolveGroupActor(deps, {
      groupId,
      actorUserId: args.actorUserId,
      isStaff: args.isStaff,
    });
    yield* ensureActorCan(actor, GroupAction.Update);

    const group = yield* deps.groupRepository.findById(groupId);

    // 変更がない場合は業務データも記録も書かずに成功を返す
    if (group.name === validatedName) {
      return okAsync(group);
    }

    const actedAsStaff = isActedAsStaff(groupPermissions, actor, GroupAction.Update);

    const auditLog: AuditLogDraft = {
      occurredAt: args.now,
      actorId: args.actorUserId,
      actedAsStaff,
      action: AuditLogAction.GroupUpdate,
      targetId: groupId,
      groupId,
      changes: toGroupNameUpdatedChanges(group.name, validatedName),
    };

    return deps.groupRepository.updateName(
      {
        id: groupId,
        name: validatedName,
        updatedAt: args.now,
      },
      auditLog,
    );
  });
