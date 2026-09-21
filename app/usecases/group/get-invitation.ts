import { errAsync, type ResultAsync } from "neverthrow";

import type { GroupError, GroupRepository } from "~/domain/group";
import { GroupErrorCode } from "~/domain/group";
import { InvitationStatus, type InvitationRepository } from "~/domain/invitation";
import { normalizeInvitationEmail } from "~/domain/invitation/invitation-email";
import type { MembershipRole } from "~/domain/membership";

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

export interface GetInvitationDeps {
  readonly invitationRepository: InvitationRepository;
  readonly groupRepository: GroupRepository;
}

export interface GetInvitationArgs {
  readonly invitationId: string;
  /** ログイン中の人のメールアドレス（未正規化） */
  readonly actorEmail: string;
  /** 有効期限を判定する基準時刻 */
  readonly now: Date;
}

/**
 * 承諾画面（SCR-016）に出す 1 つ分のデータ。
 *
 * 団体 ID を持たせていないのは、画面が使わないため。
 * COND-011 の例外は「承諾の可否を判断するために必要な範囲」に限られており、
 * 団体名と役割だけで足りる。承諾後の遷移先は承諾の結果として受け取る。
 */
export interface InvitationView {
  readonly invitationId: string;
  readonly groupName: string;
  readonly role: MembershipRole;
  readonly expiresAt: Date;
}

/**
 * 招待の承諾画面（SCR-016）に表示する招待情報を取得するユースケース（UC-022）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. invitationId を trim し、空なら DB を引かずに invitationNotFound() を返す。
 * 2. findById で招待を引く。null なら invitationNotFound() を返す。
 * 3. status !== InvitationStatus.Pending なら invitationNotFound() を返す。
 * 4. expiresAt.getTime() <= now.getTime() なら invitationNotFound() を返す（期限ちょうどは切れている扱い）。
 * 5. invitation.email !== normalizeInvitationEmail(args.actorEmail) なら invitationNotFound() を返す。
 *    ※宛先照合を団体取得より先に行う理由: 宛先が違う人に対して団体を引きに行くと、
 *    存在する団体のときだけ DB 往復が 1 回増え、応答時間の差から団体の存在を推測されてしまうため（COND-011 存在の秘匿）。
 * 6. ここまで通った人だけが COND-011 の例外（招待を提示した正規の受信者）にあたる。groupRepository.findById で団体名を取得する。
 * 7. 団体の取得が GroupNotFound だったときは invitationNotFound() に畳む。
 *    DatabaseError はそのまま返す（システム障害を 404 に潰すと監視に出ず、原因追跡ができなくなるため）。
 */
export const getInvitationUseCase = (
  deps: GetInvitationDeps,
  args: GetInvitationArgs,
): ResultAsync<InvitationView, GroupError> => {
  const invitationId = args.invitationId.trim();

  // 1. 空文字なら DB を引かずに終了（存在秘匿）
  if (invitationId === "") {
    return errAsync(invitationNotFound());
  }

  // 2. 招待を取得
  return deps.invitationRepository.findById(invitationId).andThen((invitation) => {
    if (invitation === null) {
      return errAsync(invitationNotFound());
    }

    // 3. 承諾待ち以外の状態は不可
    if (invitation.status !== InvitationStatus.Pending) {
      return errAsync(invitationNotFound());
    }

    // 4. 有効期限切れ（期限ちょうどは切れている扱い）
    if (invitation.expiresAt.getTime() <= args.now.getTime()) {
      return errAsync(invitationNotFound());
    }

    // 5. 宛先の突き合わせ（宛先が違う人には団体を引きに行かない）
    if (invitation.email !== normalizeInvitationEmail(args.actorEmail)) {
      return errAsync(invitationNotFound());
    }

    // 6. 団体名を取得（正規の受信者のみ）
    return deps.groupRepository
      .findById(invitation.groupId)
      .mapErr((error) => {
        // 7. GroupNotFound の場合は存在秘匿のため invitationNotFound に畳む。DatabaseError はそのまま返す
        if (error.code === GroupErrorCode.GroupNotFound) {
          return invitationNotFound();
        }
        return error;
      })
      .map((group) => ({
        invitationId: invitation.id,
        groupName: group.name,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      }));
  });
};
