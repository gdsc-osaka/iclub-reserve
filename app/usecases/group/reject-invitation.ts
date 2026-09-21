import { errAsync, ok, type ResultAsync } from "neverthrow";

import type { GroupError } from "~/domain/group";
import { GroupErrorCode } from "~/domain/group";
import type { InvitationRepository } from "~/domain/invitation";
import { normalizeInvitationEmail } from "~/domain/invitation/invitation-email";

/**
 * 招待を承諾できないときに返すエラー。
 *
 * 「存在しない」「期限切れ」「取り消し済み」「すでに承諾済み」「宛先が違う」を
 * すべて同じ値にまとめている。書き分けると、招待 ID を総当たりして
 * 「この招待は実在する」と分かってしまい、所属していない団体の存在が漏れる（COND-011 存在の秘匿）。
 * そのため、この関数を通さずに個別のメッセージを書いてはいけない。
 */
const invitationNotFound = (): GroupError => ({
  code: GroupErrorCode.InvitationNotFound,
  message: "招待が見つかりません。",
});

export interface RejectInvitationDeps {
  readonly invitationRepository: InvitationRepository;
}

export interface RejectInvitationArgs {
  readonly invitationId: string;
  /** ログイン中の人のメールアドレス（未正規化） */
  readonly actorEmail: string;
  readonly now: Date;
}

/**
 * 招待を辞退するユースケース（UC-022 / SCR-016）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. invitationId を trim し、空なら DB を引かずに invitationNotFound() を返す。
 * 2. invitationRepository.reject を呼び出して条件付き UPDATE を実行する。
 * 3. 辞退件数が 0 件の場合は invitationNotFound() を返し、成功時は null を返す。
 *
 * 【事前 SELECT による存在確認を行わない理由】
 * 条件付き UPDATE 1 文で「辞退できるなら辞退する・できなければ 0 件」が判定できるため、
 * 事前 SELECT を行わない。D1 への往復レイテンシを 1 回削減でき、
 * 読んでから書くまでの競合も原理的に防止できる。
 */
export const rejectInvitationUseCase = (
  deps: RejectInvitationDeps,
  args: RejectInvitationArgs,
): ResultAsync<null, GroupError> => {
  const invitationId = args.invitationId.trim();

  // 1. 空文字なら DB を引かずに終了（存在秘匿）
  if (invitationId === "") {
    return errAsync(invitationNotFound());
  }

  // 2. 条件付き UPDATE による辞退を実行（事前 SELECT は行わない）
  return deps.invitationRepository
    .reject({
      invitationId,
      email: normalizeInvitationEmail(args.actorEmail),
      now: args.now,
    })
    .andThen((rejectedCount) => {
      // 3. 辞退できた行数が 0 件なら、対象の招待が無かったか条件不一致
      if (rejectedCount === 0) {
        return errAsync(invitationNotFound());
      }

      return ok(null);
    });
};
