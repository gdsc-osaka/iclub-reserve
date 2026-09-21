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
 * 表そのものは資源ごとのドメインが持つ。
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

/** 役割の更新に必要な値。触ってよい列だけを並べる */
export interface UpdateMembershipRoleInput {
  readonly groupId: string;
  readonly userId: string;
  /**
   * 検証済みの役割。COND-007 により常に 1 つで、`isMembershipRole` を通っていること。
   * 検証はユースケースの担当で、リポジトリでは確かめ直さない。
   */
  readonly role: MembershipRole;
  readonly updatedAt: Date;
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

  /**
   * その団体の管理者の人数を数える（最後の管理者の保護に使う）。
   */
  countAdmins(groupId: string): ResultAsync<number, MembershipError>;

  /**
   * 役割を更新し、更新した行数を返す。
   *
   * 戻り値の件数について:
   * 0 件は「対象がその団体に居なかった」ということであり、DB アクセス自体の異常ではない
   * （画面を開いたあとに別の管理者が先に削除した場合など）。
   * これをどう扱うか（見つからなかったエラーとするか等）は呼び出し側（ユースケース）が決める。
   * これは `findByGroupAndUser` が「所属していない」をエラーにしないのと同じ考え方。
   *
   * 対象を member.id ではなく (groupId, userId) の組で指定する理由:
   * 認可の判定も既存の `findByGroupAndUser` もこの組を使っており、ここだけ別のキー（member.id）にすると
   * 不要なキーの突き合わせや問い合わせが増えてしまう。
   * また、member テーブルに一意制約はないが、同じユーザーが同じ団体に複数行持つのは異常なデータ状態であり、
   * その場合もまとめて反映されるほうが望ましいため。
   */
  updateRole(input: UpdateMembershipRoleInput): ResultAsync<number, MembershipError>;

  /**
   * 所属を取り消し、削除した行数を返す。
   *
   * 戻り値の件数の考え方および (groupId, userId) の組で指定する理由は updateRole と同様。
   */
  remove(groupId: string, userId: string): ResultAsync<number, MembershipError>;
}
