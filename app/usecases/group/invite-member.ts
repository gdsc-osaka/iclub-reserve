import { createId } from "@paralleldrive/cuid2";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

import type { GroupError, GroupRepository } from "~/domain/group";
import { GroupAction, GroupErrorCode, groupPermissions } from "~/domain/group";
import {
  invitationExpiresAt,
  type CreateInvitationInput,
  type InvitationRepository,
} from "~/domain/invitation";
import { validateInvitationEmail } from "~/domain/invitation/invitation-email";
import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import { createInvitationMailDraft } from "~/domain/mail/invitation-mail";
import type { MembershipError, MembershipRepository } from "~/domain/membership";
import { canPerform, isMembershipRole, type MembershipRole } from "~/domain/membership";

export interface InviteMemberDeps {
  readonly groupRepository: GroupRepository;
  readonly membershipRepository: MembershipRepository;
  readonly invitationRepository: InvitationRepository;
  /** outbox に積んだメールの即時配送を依頼する先（ADR-002 決定 1） */
  readonly mailOutboxNotifier: MailOutboxNotifier;
}

export interface InviteMemberArgs {
  readonly groupId: string;
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。団体に所属していなくても操作できる */
  readonly isStaff: boolean;
  /** フォームから届いた未検証のメールアドレス */
  readonly email: string;
  /** フォームから届いた未検証の役割 */
  readonly role: string;
  readonly now: Date;
  /** 承諾リンクを組み立てるための、このアプリの絶対 URL の土台 */
  readonly appBaseUrl: string;
}

export interface InviteMemberResult {
  readonly invitationId: string;
}

/**
 * 団体が存在しないか、あるいは所属していない（存在秘匿）ときに返すエラー。
 *
 * 「所属していないグループ」と「存在しないグループ」で同じ値を返すことで、
 * グループ ID を総当たりされても、そのグループがあるかどうかを気取られないようにする（COND-011 存在の秘匿）。
 */
const groupNotFound = (): GroupError => ({
  code: GroupErrorCode.GroupNotFound,
  message: "グループが見つかりません。",
});

/** Membership 取得時の DB エラーを GroupError に変換する */
const toGroupDatabaseError = (error: MembershipError): GroupError => ({
  code: GroupErrorCode.DatabaseError,
  message: "メンバー情報の処理に失敗しました。",
  cause: error,
});

/**
 * 団体へメンバーを招待するユースケース（REQ-017 / UC-011 / EVT-014）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. groupId のトリム検証:
 *    空文字または空白のみの場合は DB 問い合わせを行わず、即座に groupNotFound() を返す。
 * 2. メールアドレスの検証（validateInvitationEmail）:
 *    未入力、空白・改行混入、文字数超過、許可ドメイン外を弾き、小文字に正規化する。
 * 3. 役割（role）の検証（isMembershipRole）:
 *    COND-007（単一ロール原則）を満たす。未知の文字列や不正な入力値をここで弾く。
 * 4. 2・3 の検証を認可判定より先に置く理由:
 *    これらの検証結果は特定の団体に依存しないため、先に返しても団体の有無が外部に漏れることはない。
 *    一方で、無効なリクエストに対して不要な DB 問い合わせ（D1 の往復レイテンシとクエリコスト）を
 *    確実に削減できる。
 * 5. 認可判定（COND-009 / COND-011）:
 *    - 事務局スタッフの場合: 事務局は団体に所属せず（group_member 行を持たない）、全団体の管理権限を持つため、
 *      membershipRepository の所属確認をスキップして直接操作を許可する。
 *    - 一般利用者の場合: 操作者のメンバーシップを取得し、閲覧権限（GroupAction.View）がなければ
 *      存在秘匿のため groupNotFound() を返す。View 権限はあるが InviteMember 権限がない場合は、
 *      GroupForbidden「メンバーを招待できるのは管理者と事務局だけです。」を返す。
 * 6. 団体の存在確認と団体名取得（groupRepository.findById）:
 *    メールの本文に団体名を載せるために取得する。
 *    認可より後に置いている理由: 先に引くと、存在する団体のときだけ往復が 1 回増え、
 *    応答時間の差から団体の存在を推測されうるため。
 * 7. 既存の承諾待ち招待の確認（invitationRepository.findPendingByGroupAndEmail）:
 *    すでに有効期限内の承諾待ち招待がある場合は、二重招待を防ぐため GroupInvalidInput を返す。
 *    期限切れの招待は妨げにしない（送り直せるようにするため）。
 * 8. 招待と通知メールの作成:
 *    createId() で招待 ID を生成し、48 時間後の期限を決め、メールドラフトを生成する。
 * 9. 永続化（invitationRepository.create）:
 *    招待の INSERT と outbox への INSERT を同じ batch で不可分に実行する（ADR-002 決定 3）。
 * 10. 即時配送の通知（mailOutboxNotifier.notifyEnqueued）:
 *     通知に失敗してもキュー・cron で配送されるため、画面にエラーを出さないよう try/catch で囲む。
 *
 * 【同時実行の限界について】
 * 2 人の管理者が同時に同じ宛先へ招待すると、承諾待ちの招待が 2 件できる余地がある
 * （D1 では確認と書き込みを 1 つのトランザクションに包めないため）。
 * どちらの招待からでも同じ団体に入れるだけで、害は小さく、どちらも取り消せるので、
 * ここでは排他制御を入れずに割り切る。
 */
export const inviteMemberUseCase = (
  deps: InviteMemberDeps,
  args: InviteMemberArgs,
): ResultAsync<InviteMemberResult, GroupError> => {
  const groupId = args.groupId.trim();

  // 1. 空文字や空白のみの ID は DB へ問い合わせずに即座に打ち切る（存在秘匿）
  if (groupId === "") {
    return errAsync(groupNotFound());
  }

  // 2. メールアドレスのバリデーションと正規化
  const emailResult = validateInvitationEmail(args.email);
  if (emailResult.isErr()) {
    return errAsync(emailResult.error);
  }
  const normalizedEmail = emailResult.value;

  // 3. 役割の単一性と有効性のバリデーション（COND-007）
  if (!isMembershipRole(args.role)) {
    return errAsync({
      code: GroupErrorCode.GroupInvalidInput,
      message: "指定できない役割です。",
    });
  }
  const role: MembershipRole = args.role;

  // 4. 認可判定（事務局は所属確認をスキップ、一般利用者は所属と権限を確認）
  const checkPermission = (): ResultAsync<void, GroupError> => {
    if (args.isStaff) {
      return okAsync(undefined);
    }

    return deps.membershipRepository
      .findByGroupAndUser(groupId, args.actorUserId)
      .mapErr(toGroupDatabaseError)
      .andThen((actorMembership) => {
        // 閲覧権限がない場合は団体の存在自体を秘匿する（COND-011）
        if (!canPerform(groupPermissions, actorMembership, GroupAction.View)) {
          return errAsync(groupNotFound());
        }

        // 閲覧権限はあるが招待権限がない一般メンバーの場合
        if (!canPerform(groupPermissions, actorMembership, GroupAction.InviteMember)) {
          return errAsync({
            code: GroupErrorCode.GroupForbidden,
            message: "メンバーを招待できるのは管理者と事務局だけです。",
          });
        }

        return okAsync(undefined);
      });
  };

  return checkPermission().andThen(() =>
    // 5. 団体情報を取得する（メール本文に団体名を載せるため）
    deps.groupRepository.findById(groupId).andThen((group) =>
      // 6. 重複する承諾待ち招待の有無を確認する
      deps.invitationRepository
        .findPendingByGroupAndEmail(groupId, normalizedEmail)
        .andThen((existingInvitation) => {
          // 既存の招待が存在し、かつ有効期限内の場合は二重招待を弾く
          if (
            existingInvitation !== null &&
            existingInvitation.expiresAt.getTime() > args.now.getTime()
          ) {
            return errAsync({
              code: GroupErrorCode.GroupInvalidInput,
              message:
                "このメールアドレスには、すでに招待を送っています。取り消してから送り直してください。",
            });
          }

          // 期限切れの場合は再送を許可するため、そのまま新規作成を進める
          const invitationId = createId();
          const expiresAt = invitationExpiresAt(args.now);

          const mailDraft = createInvitationMailDraft({
            invitationId,
            groupName: group.name,
            email: normalizedEmail,
            role,
            expiresAt,
            appBaseUrl: args.appBaseUrl,
          });

          const createInput: CreateInvitationInput = {
            id: invitationId,
            groupId,
            email: normalizedEmail,
            role,
            inviterUserId: args.actorUserId,
            expiresAt,
            createdAt: args.now,
          };

          return deps.invitationRepository.create(createInput, [mailDraft]).map((outcome) => {
            /*
             * 招待の作成と outbox への追加が成功したあとに即時配送を依頼する（ADR-002 決定 1）。
             * 招待は既に確定しているので、通知の都合で画面にエラーを出すと
             * 利用者が同じ招待をもう一度送ってしまうため、例外は捕まえておく。
             */
            try {
              deps.mailOutboxNotifier.notifyEnqueued(outcome.enqueuedMailIds);
            } catch (error) {
              console.error("Failed to request immediate mail delivery for invitation:", error);
            }

            return { invitationId };
          });
        }),
    ),
  );
};
