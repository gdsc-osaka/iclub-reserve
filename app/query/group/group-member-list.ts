import type { ResultAsync } from "neverthrow";

import type { MembershipRole } from "~/domain/membership";
import type { QueryError } from "../error";

/** 一覧に並ぶメンバー 1 人分。画面に出す項目だけを持つ。 */
export interface GroupMemberListItem {
  /** member テーブルの行 ID。役割変更・削除のときに指す対象になる */
  readonly memberId: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly roles: readonly MembershipRole[];
}

export type GroupMemberList = readonly GroupMemberListItem[];

/**
 * 読み取り専用の窓口（ポート）。
 *
 * 返る型はドメインの不変条件を持たないので、
 * **この結果を使って更新してはいけない**。更新は必ず Repository を通すこと。
 *
 * NOTE:
 * - 認可はここでは判定しない（ADR-001 決定 7）。呼び出し側のユースケースが
 *   閲覧権限を確かめてから呼ぶこと。
 * - メールアドレスを含んでいるため、管理者・事務局以外に見せる経路で使ってはならない。
 *   一般メンバー向けの一覧では、ユースケース層でメールアドレスを除去すること。
 * - 所属メンバーが 0 件であることは異常ではない（ただし団体には必ず 1 人以上いる運用なので、
 *   実際には起きない想定）。
 * - 並び順はユーザー名の昇順で固定し、同名の場合は member.id の昇順とする。
 *   順序を決めずに返すと、再読み込みのたびに一覧の並びが入れ替わって見えてしまう。
 */
export interface GroupMemberListQuery {
  findByGroupId(groupId: string): ResultAsync<GroupMemberList, QueryError>;
}
