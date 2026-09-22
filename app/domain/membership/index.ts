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
 * メンバーの役割を利用者向けの日本語にする。
 *
 * 表示名は必ずここを通すこと。画面ごとに文字列を書くと、
 * 同じ役割が「管理者」「管理者ユーザー」のように場所によって違う名前で出てしまう。
 *
 * 画面（バッジ）だけでなく招待メールの本文でも使うため、部品ではなくドメインに置いている。
 */
export const membershipRoleLabel: Record<MembershipRole, string> = {
  [MembershipRole.Admin]: "管理者",
  [MembershipRole.Member]: "メンバー",
};

/**
 * 文字列がこのアプリの役割かどうかを判定する。
 *
 * DB やフォームから来た文字列が、このアプリの役割かどうかを確かめるために使う。
 */
export const isMembershipRole = (value: string): value is MembershipRole =>
  (Object.values(MembershipRole) as readonly string[]).includes(value);

/**
 * ユーザーがグループに所属していることを表すドメインモデル。
 */
export interface Membership {
  readonly groupId: string;
  readonly userId: string;
  readonly role: MembershipRole;
}

/**
 * 事務局を表す、認可の判定にだけ使う役割。
 *
 * 事務局は group_member の行を持たない (COND-009: 所属に関わらず全団体を操作できる) ので、
 * 保存される役割 (MembershipRole) とは別の値にしてある。
 *
 * この値をフォームから届いた文字列の検証に使ってはいけない。
 * 保存される役割の入口は `isMembershipRole` だけであり、
 * そこを staff が通ると、団体の管理者が事務局を作れてしまう。
 */
export const StaffRole = "staff" as const;

/** 認可の判定に使う役割。保存される役割と事務局を合わせたもの */
export type ActorRole = MembershipRole | typeof StaffRole;

/**
 * 操作する人。
 *
 * 事務局かどうかと、その資源が属する団体での所属を別々に持つ。
 * 2 つは別の軸にあり (COND-009)、どちらか一方には畳めない。
 *
 * 一覧のように複数の団体の資源が混ざる画面では、行ごとに組み立てること。
 * 1 つを使い回すと、自団体の権限で他団体の資源を読んでしまう。
 */
export interface Actor {
  /** 事務局スタッフかどうか (COND-009) */
  readonly isStaff: boolean;
  /** その資源が属する団体での所属。所属していなければ null */
  readonly membership: Membership | null;
}

/**
 * 操作する人が持つ役割をすべて挙げる。
 *
 * 事務局でありながら、その団体のメンバーでもあることがある。
 * 例えば事務局の人が自分の所属する団体の予約を取り消す場合、
 * 使われるのはメンバーとしての権限であって、事務局の権限ではない。
 * どちらか一方に畳むと、畳んだ側の権限が消える。
 *
 * 役割を 1 つも持たない場合は空になり、表の `base` だけが効く。
 */
export const actorRoles = (actor: Actor): readonly ActorRole[] => {
  const roles: ActorRole[] = [];

  if (actor.isStaff) {
    roles.push(StaffRole);
  }
  if (actor.membership !== null) {
    roles.push(actor.membership.role);
  }

  return roles;
};

/**
 * 操作する人がその資源に対して操作を実行できるかを判定する。
 *
 * 認可の判定は、資源側の表を直接読まずに必ずこの関数を通すこと。
 * 表を直接読むと「所属しているか」「事務局か」の判定が抜け落ちる。
 */
export const canAct = <R extends string, A extends string>(
  table: PermissionTable<R, A>,
  actor: Actor,
  action: A,
): boolean => rolesCan(table, actorRoles(actor), action);

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
   *
   * group_member テーブルには (group_id, user_id) の一意制約があるので、
   * 行数＝人数である。
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
