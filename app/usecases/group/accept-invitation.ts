import { createId } from "@paralleldrive/cuid2";
import { errAsync, ok, type ResultAsync } from "neverthrow";

import type { GroupError } from "~/domain/group";
import type { InvitationRepository } from "~/domain/invitation";
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
 * 2. invitationRepository.accept を呼び出して条件付き更新とメンバー作成を実行する。
 * 3. 承諾対象が見つからず null が返った場合は invitationNotFound() を返し、成功時は groupId を返す。
 *
 * 【事前 SELECT による存在確認を行わない理由】
 * 事前に findById を呼んで確かめるのではなく、リポジトリ層の条件付き UPDATE 1 文（および batch 内の INSERT ... SELECT）に
 * 判定を畳み込んでいる。これにより、D1 への往復レイテンシが 1 回削減され、
 * 「読んでから書く」までの間に他者が取り消す・本人が二重送信するといった競合が原理的に起きなくなる。
 */
export const acceptInvitationUseCase = (
  deps: AcceptInvitationDeps,
  args: AcceptInvitationArgs,
): ResultAsync<AcceptInvitationResult, GroupError> => {
  const invitationId = args.invitationId.trim();

  // 1. 空文字なら DB を引かずに終了（存在秘匿）
  if (invitationId === "") {
    return errAsync(invitationNotFound());
  }

  // 2. 条件付き UPDATE とメンバー追加を実行（事前 SELECT は行わない）
  return deps.invitationRepository
    .accept({
      invitationId,
      email: normalizeInvitationEmail(args.actorEmail),
      userId: args.actorUserId,
      membershipId: createId(),
      now: args.now,
    })
    .andThen((groupId) => {
      // 3. 対象の招待が無かった（条件に合致しなかった）場合
      if (groupId === null) {
        return errAsync(invitationNotFound());
      }

      return ok({ groupId });
    });
};
