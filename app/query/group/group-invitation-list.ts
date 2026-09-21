import type { ResultAsync } from "neverthrow";

import type { MembershipRole } from "~/domain/membership";
import type { QueryError } from "../error";

/** 一覧に並ぶ承諾待ちの招待 1 件分。画面に出す項目だけを持つ。 */
export interface GroupInvitationListItem {
  readonly id: string;
  readonly email: string;
  readonly roles: readonly MembershipRole[];
  readonly expiresAt: Date;
}

export type GroupInvitationList = readonly GroupInvitationListItem[];

/**
 * 承諾待ちの招待一覧を取得する読み取り専用の窓口（ポート）。
 *
 * 返る型はドメインの不変条件を持たないので、
 * **この結果を使って更新してはいけない**。更新は必ず Repository を通すこと。
 *
 * NOTE:
 * - status = 'pending' の招待だけを返す。
 * - 期限切れの除外はここでは行わない。ADR-001 により findByGroupId(groupId) という
 *   「ID のみを引数に取る」形が決められており、now などの基準時刻を引数に足すと
 *   ポートの責務が崩れてしまうため。期限切れの判定はユースケース側で行う。
 * - 並び順は有効期限（expiresAt）の昇順で固定し、同じ期限の場合は invitation.id の昇順とする。
 */
export interface GroupInvitationListQuery {
  findByGroupId(groupId: string): ResultAsync<GroupInvitationList, QueryError>;
}
