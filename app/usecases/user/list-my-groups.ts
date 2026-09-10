import type { ResultAsync } from "neverthrow";

import type { QueryError } from "~/query/error";
import type { UserGroupList, UserGroupListQuery } from "~/query/user/user-group-list";

/** このユースケースが必要とする依存 */
export interface ListMyGroupsDeps {
  readonly userGroupListQuery: UserGroupListQuery;
}

/** このユースケースへの入力 */
export interface ListMyGroupsArgs {
  /** 一覧を見ようとしているユーザーの ID */
  readonly actorUserId: string;
}

/**
 * 自分が所属している団体を一覧するユースケース。
 *
 * 画面の共通部分（サイドバー・ボトムバー）とダッシュボードが、
 * 「どの団体に所属しているか」「承認待ちの団体があるか」を出すために使う。
 *
 * 認可の判定を書いていないのは、判定が要らない形にしてあるため。
 * 取得条件そのものが「actorUserId が所属しているもの」なので、
 * 他人の所属が混ざる余地がない。
 * ここに他人の ID を渡せる引数（例: targetUserId）を足すと
 * その保証が崩れるので、足すときは必ず認可の判定も一緒に入れること。
 *
 * NOTE: 判定が無くてもこの層を素通しで残しているのは、
 * loader から Query を直接呼ぶ形にすると、上のルールを書き足す場所が
 * 無くなるため（ADR-001 決定 7）。
 *
 * NOTE: 空の ID を弾いていないのは、呼び出し元が
 * `requireRequestUser` で取得したログイン中のユーザーに限られるため。
 * 万一空文字が渡っても、一致する所属が無いので ok([]) になる。
 */
export const listMyGroupsUseCase = (
  deps: ListMyGroupsDeps,
  args: ListMyGroupsArgs,
): ResultAsync<UserGroupList, QueryError> => deps.userGroupListQuery.findByUserId(args.actorUserId);
