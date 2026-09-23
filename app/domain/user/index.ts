import type { ResultAsync } from "neverthrow";
import { ErrorKind, type BaseError } from "../error";

/**
 * ユーザーを表すドメインモデル。
 *
 * DB のテーブル定義 (snake_case) には依存させず、
 * アプリケーション内で扱いやすい形 (camelCase) に整えている。
 * DB のカラム名が変わっても、この型を変えずに済むようにするのが狙い。
 */
export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  /** 事務局スタッフかどうか */
  readonly isStaff: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * ユーザーに関するエラーの種類。
 *
 * 列挙子の名前は型名を繰り返さないが、文字列の値は変えないこと（ADR-004 決定 1）。
 * ログに出るのは値の方なので、変えると過去のログと突き合わせられなくなる。
 */
export const UserErrorCode = {
  /** 指定された ID のユーザーが存在しない */
  NotFound: "USER_NOT_FOUND",
  /** DB へのアクセスに失敗した */
  DatabaseError: "DATABASE_ERROR",
} as const;
export type UserErrorCode = (typeof UserErrorCode)[keyof typeof UserErrorCode];

/**
 * ユーザーに関するエラーコードの分類（ADR-004 決定 3）。
 *
 * HTTP の status とログのレベルは、この表から決まる。
 * いまはユーザーのユースケースを使う画面が無いので、利用者にどう見せるかの表
 * （`app/routes/_shared/`）はまだ無い。画面から使うときに足すこと。
 */
export const userErrorKind: Record<UserErrorCode, ErrorKind> = {
  [UserErrorCode.NotFound]: ErrorKind.NotFound,
  [UserErrorCode.DatabaseError]: ErrorKind.Internal,
};

/**
 * ユーザーに関するドメインエラー。
 */
export interface UserError extends BaseError {
  readonly code: UserErrorCode;
}

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
   * - 見つからなかった場合: err(USER_NOT_FOUND)
   * - DB アクセスに失敗した場合: err(DATABASE_ERROR)
   */
  findById(id: string): ResultAsync<User, UserError>;
}
