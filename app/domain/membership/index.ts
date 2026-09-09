import type { ResultAsync } from "neverthrow";
import type { PermissionTable } from "../authz";
import { rolesCan } from "../authz";
import type { BaseError } from "../error";

/**
 * グループにおけるメンバーの役割。
 */
export const MembershipRole = {
  Admin: "admin",
  Member: "member",
} as const;
export type MembershipRole = (typeof MembershipRole)[keyof typeof MembershipRole];

/**
 * 文字列がこのアプリの役割かどうかを判定する。
 *
 * Better Auth は自前で `owner` を含む既定の役割一覧を持っており、
 * 役割名の検証にはそれと設定側をマージした一覧を使う
 * (better-auth の crud-members.ts の `validStaticRoles`)。
 * そのため `roles` に admin と member しか渡していなくても、
 * API からは `owner` を設定できてしまう。
 *
 * その `owner` は Better Auth の判定 (hasPermission) では何の権限も持たず、
 * こちらの `toMembershipRoles` では未知として捨てられる。
 * どちらから見ても意味を成さない役割なので、入口で弾くために使う。
 */
export const isMembershipRole = (value: string): value is MembershipRole =>
  (Object.values(MembershipRole) as readonly string[]).includes(value);

/**
 * ユーザーがグループに所属していることを表すドメインモデル。
 */
export interface Membership {
  readonly groupId: string;
  readonly userId: string;
  readonly roles: readonly MembershipRole[];
}

/**
 * ユーザーがそのグループで操作を実行できるかを判定する。
 *
 * 所属していない場合は `membership` に null を渡す。null なら必ず false になるので、
 * 「所属していないグループでは何もできない」が判定を書き忘れようのない形で保証される。
 * 認可の判定は、資源側の表を直接読まずに必ずこの関数を通すこと。
 * 各ドメインが `membership !== null` を自前で書く形にすると、
 * いつか書き忘れが起きる。
 *
 * 表そのものは資源ごとのドメインが持つ (app/domain/group.ts の `groupPermissions` など)。
 * ここが知っているのは「Membership が表に対して何を意味するか」だけ。
 */
export const canPerform = <A extends string>(
  table: PermissionTable<MembershipRole, A>,
  membership: Membership | null,
  action: A,
): boolean => membership !== null && rolesCan(table, membership.roles, action);

/** メンバーシップに関するエラーの種類 */
export const MembershipErrorCode = {
  /** DB へのアクセスに失敗した */
  DatabaseError: "DATABASE_ERROR",
} as const;
export type MembershipErrorCode = (typeof MembershipErrorCode)[keyof typeof MembershipErrorCode];

/**
 * メンバーシップに関するドメインエラー。
 *
 * 「所属していない」はエラーに含めない。詳しくは MembershipRepository を参照。
 */
export interface MembershipError extends BaseError {
  readonly code: MembershipErrorCode;
}

/**
 * メンバーシップの永続化層に対する窓口 (ポート)。
 */
export interface MembershipRepository {
  /**
   * ユーザーがそのグループに所属しているかを調べる。
   *
   * - 所属している場合: ok(Membership)
   * - 所属していない場合: ok(null)
   * - DB アクセスに失敗した場合: err(DATABASE_ERROR)
   *
   * NOTE: 他のリポジトリの `findById` は「1 件を取りに行く」問いなので
   * 見つからなければ err(NOT_FOUND) を返すが、こちらは「所属しているか」を
   * 尋ねる問いであり、所属していないことは認可判定の正常な入力なのでエラーにしない。
   *
   * err にしてしまうと、呼び出し側が NOT_FOUND を ok(null) に畳み直す処理を
   * 書くことになる。そこを書き間違えると DB エラーまで「所属していない」に
   * 潰れてしまい、障害が「グループが見つかりません」と表示されて気づけなくなる。
   */
  findByGroupAndUser(
    groupId: string,
    userId: string,
  ): ResultAsync<Membership | null, MembershipError>;
}
