import { err, errAsync, ok, okAsync, ResultAsync, safeTry, type Result } from "neverthrow";

import {
  GroupAction,
  GroupErrorCode,
  GroupStatus,
  type Group,
  type GroupError,
  type GroupRepository,
} from "~/domain/group";
import {
  canChangeGroupStatus,
  type GroupStatusChangeTarget,
} from "~/domain/group/status-transition";
import type { MembershipRepository } from "~/domain/membership";
import { ensureGroupPermission, groupNotFound } from "./_shared/group-authorization";

export interface ChangeGroupStatusDeps {
  readonly groupRepository: GroupRepository;
  readonly membershipRepository: MembershipRepository;
}

export interface ChangeGroupStatusArgs {
  readonly groupId: string;
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。団体の有効化・無効化は事務局限定 */
  readonly isStaff: boolean;
  /** フォームから届いた変更後のステータス文字列 */
  readonly status: string;
  readonly now: Date;
}

/**
 * 変更先ステータス文字列を検証する。
 *
 * 事務局が変更先として指定できるのは "enabled" または "disabled" のみ（STATE-002）。
 */
const validateTargetStatus = (status: string): Result<GroupStatusChangeTarget, GroupError> => {
  if (status === GroupStatus.Enabled || status === GroupStatus.Disabled) {
    return ok(status);
  }

  return err({
    code: GroupErrorCode.InvalidInput,
    message: "変更後のステータスに、有効・無効以外の値が指定された。",
    userMessage: "変更後の状態は「有効」または「無効」を指定してください。",
  });
};

/**
 * 今の状態から、指定された状態へ変えてよいかを確かめる門番。
 *
 * 事務局が古い画面から操作したとき（別の事務局がすでに変えていた、など）に止まるので、
 * 文言は読み込み直しを促すものにしている。
 */
const ensureStatusTransitionAllowed = (group: Group, to: GroupStatus): Result<null, GroupError> =>
  canChangeGroupStatus(group.status, to)
    ? ok(null)
    : err({
        code: GroupErrorCode.InvalidTransition,
        message: `団体 ${group.id} の状態を ${group.status} から ${to} へは変えられない。`,
        userMessage: "団体の状態が変わっています。画面を読み込み直してください。",
      });

/**
 * 団体の有効化・無効化を行うユースケース（UC-014 / REQ-021）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. groupId のトリム検証:
 *    空文字の場合は DB 問い合わせを行わず、即座に groupNotFound() を返す。
 * 2. status の入力検証（validateTargetStatus）:
 *    無効な値であれば DB 問い合わせ前に InvalidInput を返す。
 * 3. 認可判定（ensureGroupPermission）:
 *    団体を引く前に実行する。事務局以外のユーザーに対して団体の存在有無を漏洩させないため
 *    （未所属なら NotVisible、管理者なら Forbidden）。
 * 4. 団体の取得（findById）:
 *    存在しなければ NotFound を返す。
 * 5. 状態遷移の検証（ensureStatusTransitionAllowed）:
 *    許されない遷移（同一状態への変更、pending への戻し）の場合は InvalidTransition を返す。
 * 6. 楽観的ロックを伴う更新（updateStatus）:
 *    WHERE id = ? AND status = from 条件で更新し、競合して 0 行更新なら InvalidTransition を返す。
 */
export const changeGroupStatusUseCase = (
  deps: ChangeGroupStatusDeps,
  args: ChangeGroupStatusArgs,
): ResultAsync<Group, GroupError> =>
  safeTry(async function* () {
    const groupId = args.groupId.trim();
    if (groupId === "") {
      return errAsync(groupNotFound());
    }

    const targetStatus = yield* validateTargetStatus(args.status);

    // 認可判定: 事務局でなければ団体を引く前に拒否する（存在秘匿）
    yield* ensureGroupPermission(deps, { ...args, groupId }, GroupAction.ChangeStatus);

    const group = yield* deps.groupRepository.findById(groupId);

    yield* ensureStatusTransitionAllowed(group, targetStatus);

    const updated = yield* deps.groupRepository.updateStatus({
      id: groupId,
      from: group.status,
      to: targetStatus,
      updatedAt: args.now,
    });

    return okAsync(updated);
  });
