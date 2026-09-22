import { err, ok, type Result } from "neverthrow";

import { GroupErrorCode, type GroupError } from "~/domain/group";
import { isMembershipRole, type MembershipRole } from "~/domain/membership";

/**
 * フォームから届いた未検証の役割を検証する（COND-007 単一ロール原則）。
 *
 * isMembershipRole が通すのは "admin" と "member" の完全一致だけなので、
 * "admin,member" のような複数指定も、未知の文字列も、ここで確実に弾ける。
 *
 * 通した値がそのまま `group_member.role` に保存される。事務局（StaffRole）が
 * この入口を通ると団体の管理者が事務局を作れてしまうため、
 * 役割の検証はこの 1 本を通すこと。
 */
export const validateMembershipRole = (role: string): Result<MembershipRole, GroupError> =>
  isMembershipRole(role)
    ? ok(role)
    : err({
        code: GroupErrorCode.GroupInvalidInput,
        message: "指定できない役割です。",
      });
