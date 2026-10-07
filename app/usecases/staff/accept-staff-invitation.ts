import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";

import { normalizeInvitationEmail } from "~/domain/invitation/invitation-email";
import type { StaffError, StaffInvitationRepository } from "~/domain/staff";
import { staffInvitationNotFound } from "./_shared/staff-invitation-visibility";

export interface AcceptStaffInvitationDeps {
  readonly staffInvitationRepository: StaffInvitationRepository;
}

export interface AcceptStaffInvitationArgs {
  readonly invitationId: string;
  readonly actorUserId: string;
  /** ログイン中の人のメールアドレス（未正規化） */
  readonly actorEmail: string;
  readonly now: Date;
}

/**
 * 事務局招待を承諾するユースケース（UC-027 / SCR-020）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. invitationId を trim し、空なら DB を引かずに staffInvitationNotFound() を返す。
 * 2. staffInvitationRepository.accept を呼び出して条件付き更新を実行する。
 * 3. 承諾対象が見つからず false が返った場合は staffInvitationNotFound() を返し、成功時は null を返す。
 *
 * 【事前 SELECT による存在確認を行わない理由】
 * 事前に findById を呼んで確かめるのではなく、リポジトリ層の条件付き UPDATE に
 * 判定を畳み込んでいる。これにより、D1 への往復レイテンシが 1 回削減され、
 * 「読んでから書く」までの間に他者が取り消す・本人が二重送信するといった競合が原理的に起きなくなる。
 *
 * 【宛先違いを `StaffErrorCode.InvitationNotVisible` と見分けない理由】
 * 判定を UPDATE の条件に畳み込んでいるので、どの条件で外れたのかは分からない。
 * 見分けるために事前に SELECT すると、上の利点を失う。
 * 宛先違いは、承諾より前に画面を開いた時点（`getStaffInvitationUseCase`）で `InvitationNotVisible` として残る。
 */
export const acceptStaffInvitationUseCase = (
  deps: AcceptStaffInvitationDeps,
  args: AcceptStaffInvitationArgs,
): ResultAsync<null, StaffError> =>
  safeTry(async function* () {
    const invitationId = args.invitationId.trim();

    // 1. 空文字なら DB を引かずに終了（存在秘匿）
    if (invitationId === "") {
      return errAsync(staffInvitationNotFound("承諾する事務局招待の ID が空である。"));
    }

    // 2. 条件付き UPDATE による承諾を実行（事前 SELECT は行わない）
    const accepted = yield* deps.staffInvitationRepository.accept({
      invitationId,
      email: normalizeInvitationEmail(args.actorEmail),
      userId: args.actorUserId,
      now: args.now,
    });

    // 3. 対象の招待が無かった（条件に合致しなかった）場合
    if (!accepted) {
      return errAsync(
        staffInvitationNotFound(
          "承諾できる招待が無かった（無い・期限切れ・承諾待ちではない・宛先違いのどれか）。",
        ),
      );
    }

    return okAsync(null);
  });
