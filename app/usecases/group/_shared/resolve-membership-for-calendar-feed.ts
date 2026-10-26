import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";

import { GroupErrorCode, type GroupError, type GroupRepository } from "~/domain/group";
import type { MembershipRepository, StoredMembership } from "~/domain/membership";
import { groupNotFound, groupNotVisible, toGroupDatabaseError } from "./group-authorization";

export interface ResolveMembershipForCalendarFeedDeps {
  readonly groupRepository: GroupRepository;
  readonly membershipRepository: MembershipRepository;
}

export interface ResolveMembershipForCalendarFeedArgs {
  readonly groupId: string;
  readonly actorUserId: string;
  readonly isStaff: boolean;
}

/**
 * 自団体のカレンダー購読を発行・作り直しできる所属（group_member）を特定する門番（ADR-013 決定 6）。
 *
 * 【認可のルール（COND-029(1)）】
 * - 団体が存在しない場合は、既存の団体の操作と同じく NotFound を返す。
 * - 団体に所属していない一般利用者（事務局以外）には、存在秘匿（COND-011）のため NotVisible を返す。
 * - 団体に所属していない事務局スタッフには、Forbidden（userMessage: "所属していない団体の購読 URL は発行できません。"）を返す。
 *   groupPermissions は「事務局は全権限を含む」前提のため使わず、ここで個別に止める。
 * - 団体に所属していれば、役割（管理者・メンバー）を問わず通し、所属の行（StoredMembership）を返す。
 */
export const resolveMembershipForCalendarFeed = (
  deps: ResolveMembershipForCalendarFeedDeps,
  args: ResolveMembershipForCalendarFeedArgs,
): ResultAsync<StoredMembership, GroupError> =>
  safeTry(async function* () {
    const groupId = args.groupId.trim();
    if (groupId === "") {
      return errAsync(groupNotFound());
    }

    const membership = yield* deps.membershipRepository
      .findByGroupAndUser(groupId, args.actorUserId)
      .mapErr(toGroupDatabaseError);

    if (membership === null) {
      if (!args.isStaff) {
        return errAsync(groupNotVisible());
      }

      // 事務局の場合は団体の存在を確かめる（存在しない場合は既存と同じ NotFound）
      yield* deps.groupRepository.findById(groupId);

      return errAsync({
        code: GroupErrorCode.Forbidden,
        message: "所属していない事務局が、団体のカレンダー購読を操作しようとした。",
        userMessage: "所属していない団体の購読 URL は発行できません。",
      });
    }

    // 所属の行があれば団体も存在する（外部キー）ので、団体は読み直さない
    return okAsync(membership);
  });
