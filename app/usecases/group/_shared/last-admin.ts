import { errAsync, okAsync, type ResultAsync } from "neverthrow";

import { GroupErrorCode, type GroupError } from "~/domain/group";
import { wouldRemoveLastAdmin } from "~/domain/group/admin-count";
import type { MembershipRepository } from "~/domain/membership";
import { toGroupDatabaseError } from "./group-authorization";

/** 管理者の人数を数えるために必要な依存 */
export interface LastAdminDeps {
  readonly membershipRepository: MembershipRepository;
}

/** 操作によって対象の役割がどう変わるか */
export interface LastAdminTarget {
  /** 操作の対象が、現在管理者かどうか */
  readonly targetIsAdmin: boolean;
  /** 操作したあとも、対象が管理者のままかどうか（メンバーへの降格や削除なら false） */
  readonly targetStaysAdmin: boolean;
}

/**
 * 操作の結果、団体の管理者が居なくなってしまわないかを確かめる（GROUP_MIN_ADMIN_COUNT）。
 *
 * 管理者が減らない操作では countAdmins を呼ばない。判定そのものは
 * wouldRemoveLastAdmin も同じ条件を持っているが、こちらは DB を引く前の足切りで、
 * 昇格や変更なしのときに無駄な往復を作らないために置いている。
 *
 * 拒否したときに利用者へ出す文言を引数で受け取るのは、操作によって言い方が変わるため
 * （降格できません／削除できません）。利用者にどちらの操作を止めたのかが伝わらないと、
 * 何をすれば先へ進めるのかが分からない。
 */
export const ensureNotLastAdmin = (
  deps: LastAdminDeps,
  groupId: string,
  target: LastAdminTarget,
  userMessage: string,
): ResultAsync<null, GroupError> => {
  if (!target.targetIsAdmin || target.targetStaysAdmin) {
    return okAsync<null, GroupError>(null);
  }

  return deps.membershipRepository
    .countAdmins(groupId)
    .mapErr(toGroupDatabaseError)
    .andThen((adminCount) =>
      /*
       * 対象が自分自身かどうかは見ない。
       * 「他に管理者が残っているなら自分を降格・脱退してもよい」という運用方針が、
       * wouldRemoveLastAdmin の判定（残り 1 人以上）にそのまま含まれているため。
       */
      wouldRemoveLastAdmin({ adminCount, ...target })
        ? errAsync<null, GroupError>({
            code: GroupErrorCode.LastAdminRequired,
            message: "最後の管理者を外す操作を拒否した。",
            userMessage,
          })
        : okAsync<null, GroupError>(null),
    );
};
