import type { ResultAsync } from "neverthrow";

import type { User, UserId } from "./user";
import type { UserError } from "./user-error";

/**
 * ユーザーの永続化層に対する窓口 (ポート)。
 *
 * domain 層では「何ができるか」だけを定義し、
 * 実際に D1 へ問い合わせる処理は infra 層が実装する。
 * こうすることで usecase 層は DB の存在を知らずに書ける。
 *
 * 戻り値を ResultAsync にしているので、DB エラーは例外ではなく
 * 型に現れる値として扱われ、呼び出し側が処理を忘れられない。
 */
export interface UserRepository {
  /**
   * ID でユーザーを 1 件取得する。
   *
   * - 見つかった場合: ok(User)
   * - 見つからなかった場合: ok(undefined) ... 「居ない」は異常ではないので成功扱い
   * - DB アクセスに失敗した場合: err(UserError)
   */
  readonly findById: (id: UserId) => ResultAsync<User | undefined, UserError>;
}
