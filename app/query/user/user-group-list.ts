import type { ResultAsync } from "neverthrow";

import type { GroupStatus } from "~/domain/group";
import type { MembershipRole } from "~/domain/membership";
import type { QueryError } from "../error";

/**
 * 一覧に並ぶ団体 1 件分。画面に出す項目だけを持つ。
 *
 * `createdAt` / `updatedAt` を持たせていないのは、どの画面も出していないため。
 * Query は「集約をそのまま返す」のではなく「画面 1 つ分」を返すので、
 * 使わない列は最初から取らない。
 */
export interface UserGroupListItem {
  readonly id: string;
  readonly name: string;
  readonly status: GroupStatus;
  /** その団体でのこのユーザーの役割。管理者かどうかの判定に使う */
  readonly roles: readonly MembershipRole[];
}

/**
 * 「自分が所属している団体の一覧」画面 1 つ分のデータ。
 *
 * 見出しに当たる情報 (団体数など) は配列の長さから分かるので、
 * `GroupMemberList` のような入れ物のオブジェクトでは包まない。
 */
export type UserGroupList = readonly UserGroupListItem[];

/**
 * 読み取り専用の窓口 (ポート)。
 *
 * 返る型はドメインの不変条件を持たないので、
 * **この結果を使って更新してはいけない**。更新は必ず Repository を通すこと。
 *
 * NOTE: SCR-008 の団体一覧画面はここにメンバー数を足して使う想定。
 * 「自分が所属している団体を名前で並べる」という入口と出口が同じなので、
 * 別ファイルには分けず、この Query に列を足すこと。
 */
export interface UserGroupListQuery {
  /**
   * 指定したユーザーが所属している団体を、すべて取得する。
   *
   * - 1 件も所属していない場合: ok([])
   * - DB アクセスに失敗した場合: err(DATABASE_ERROR)
   *
   * NOTE: 所属が 0 件なのは異常ではないので、NOT_FOUND にはしない。
   * ここをエラーにすると、まだどの団体にも入っていない人の画面が
   * 「見つかりません」になってしまう。
   *
   * 並び順は団体名の昇順で固定する。順序を決めずに返すと、
   * 再読み込みのたびに一覧の並びが入れ替わって見えるおそれがある。
   */
  findByUserId(userId: string): ResultAsync<UserGroupList, QueryError>;
}
