import type { ResultAsync } from "neverthrow";
import { normalizeInvitationEmail } from "~/domain/invitation/invitation-email";
import type { QueryError } from "~/query/error";
import type { UserInvitationItem, UserInvitationsQuery } from "~/query/group/user-invitations";

export interface ListMyInvitationsDeps {
  readonly userInvitationsQuery: UserInvitationsQuery;
}

export interface ListMyInvitationsArgs {
  /** ログイン中のユーザーのメールアドレス（未正規化） */
  readonly actorEmail: string;
  readonly now: Date;
}

/**
 * ログインユーザー宛ての承諾待ち・期限内の招待一覧を取得するユースケース（UC-022）。
 */
export const listMyInvitationsUseCase = (
  deps: ListMyInvitationsDeps,
  args: ListMyInvitationsArgs,
): ResultAsync<readonly UserInvitationItem[], QueryError> => {
  const normalizedEmail = normalizeInvitationEmail(args.actorEmail);
  return deps.userInvitationsQuery.findPendingInvitationsForEmail(normalizedEmail, args.now);
};
