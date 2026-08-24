import type { ResultAsync } from "neverthrow";
import { err, errAsync, ok } from "neverthrow";

import type { User } from "~/domain/user";
import { isValidUserId } from "~/domain/user";
import type { UserError } from "~/domain/user-error";
import { invalidUserId, userNotFound } from "~/domain/user-error";
import type { UserRepository } from "~/domain/user-repository";

/** このユースケースが必要とする依存 */
export interface GetUserDeps {
  readonly userRepository: UserRepository;
}

/** このユースケースへの入力 */
export interface GetUserInput {
  readonly userId: string;
}

/** ユーザー取得ユースケースの型 */
export type GetUser = (input: GetUserInput) => ResultAsync<User, UserError>;

/**
 * ユーザー ID を指定して、そのユーザーの情報を 1 件取得するユースケース。
 *
 * 依存 (リポジトリ) を引数で受け取る形にしているので、
 * テスト時には D1 を使わないダミーのリポジトリに差し替えられる。
 *
 * エラーは throw せず ResultAsync で返すため、
 * 呼び出し側は必ず成功・失敗の両方を処理することになる。
 */
export const createGetUser =
  (deps: GetUserDeps): GetUser =>
  ({ userId }) => {
    const id = userId.trim();
    if (!isValidUserId(id)) {
      return errAsync(invalidUserId());
    }

    // findById が失敗した場合、andThen の中身は実行されずエラーがそのまま伝播する
    return deps.userRepository
      .findById(id)
      .andThen((user) => (user === undefined ? err(userNotFound(id)) : ok(user)));
  };
