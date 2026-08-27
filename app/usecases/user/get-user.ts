import type { ResultAsync } from "neverthrow";
import { errAsync } from "neverthrow";

import type { User, UserError, UserRepository } from "~/domain/user";
import { UserErrorCode } from "~/domain/user";

/** このユースケースが必要とする依存 */
export interface GetUserDeps {
  readonly userRepository: UserRepository;
}

/** このユースケースへの入力 */
export interface GetUserArgs {
  readonly userId: string;
}

/**
 * ユーザー ID を指定して、そのユーザーの情報を 1 件取得するユースケース。
 *
 * 依存 (リポジトリ) を引数で受け取る形にしているので、
 * テスト時には D1 を使わないダミーのリポジトリに差し替えられる。
 *
 * エラーは throw せず ResultAsync で返すため、
 * 呼び出し側は必ず成功・失敗の両方を処理することになる。
 *
 * NOTE: ユーザーが存在しない場合に USER_NOT_FOUND を返すのは
 * リポジトリ側の責務なので、ここでは結果をそのまま伝播させる。
 */
export const getUserUseCase = (
  deps: GetUserDeps,
  args: GetUserArgs,
): ResultAsync<User, UserError> => {
  const id = args.userId.trim();

  // 空文字や空白だけの ID は DB へ問い合わせるまでもないので、ここで打ち切る
  if (id === "") {
    return errAsync({
      code: UserErrorCode.UserNotFound,
      message: "ユーザー ID が指定されていません。",
    });
  }

  return deps.userRepository.findById(id);
};
