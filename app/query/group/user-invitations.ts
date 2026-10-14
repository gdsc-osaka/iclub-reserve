import type { ResultAsync } from "neverthrow";
import type { MembershipRole } from "~/domain/membership";
import type { QueryError } from "../error";

/**
 * ログインユーザー宛ての招待情報（ダッシュボード等で表示）。
 */
export interface UserInvitationItem {
  readonly id: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly role: MembershipRole;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface UserInvitationsQuery {
  /**
   * 指定されたメールアドレス宛ての、承諾待ちかつ期限内の招待一覧を取得する（UC-022）。
   */
  findPendingInvitationsForEmail(
    normalizedEmail: string,
    now: Date,
  ): ResultAsync<readonly UserInvitationItem[], QueryError>;
}
