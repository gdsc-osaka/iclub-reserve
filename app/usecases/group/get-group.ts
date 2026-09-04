import type { ResultAsync } from "neverthrow";
import { errAsync } from "neverthrow";

import type { Group, GroupError, GroupRepository } from "~/domain/group";
import { GroupErrorCode } from "~/domain/group";

/** このユースケースが必要とする依存 */
export interface GetGroupDeps {
  readonly groupRepository: GroupRepository;
}

/** このユースケースへの入力 */
export interface GetGroupArgs {
  readonly groupId: string;
}

/**
 * グループ ID を指定して、そのグループの情報を 1 件取得するユースケース。
 *
 * 依存 (リポジトリ) を引数で受け取る形にしているので、
 * テスト時には D1 を使わないダミーのリポジトリに差し替えられる。
 *
 * エラーは throw せず ResultAsync で返すため、
 * 呼び出し側は必ず成功・失敗の両方を処理することになる。
 *
 * NOTE: グループが存在しない場合に GROUP_NOT_FOUND を返すのは
 * リポジトリ側の責務なので、ここでは結果をそのまま伝播させる。
 */
export const getGroupUseCase = (
  deps: GetGroupDeps,
  args: GetGroupArgs,
): ResultAsync<Group, GroupError> => {
  const id = args.groupId.trim();

  // 空文字や空白だけの ID は DB へ問い合わせるまでもないので、ここで打ち切る
  if (id === "") {
    return errAsync({
      code: GroupErrorCode.GroupNotFound,
      message: "グループ ID が指定されていません。",
    });
  }

  return deps.groupRepository.findById(id);
};
