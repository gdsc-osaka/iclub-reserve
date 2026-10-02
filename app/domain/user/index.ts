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
  /** 対象のセッションが見つからない（存在しない、または他人のセッション） */
  SessionNotFound: "SESSION_NOT_FOUND",
  /** 利用中のセッションをログアウトしようとした */
  CurrentSession: "CURRENT_SESSION",
} as const;
export type UserErrorCode = (typeof UserErrorCode)[keyof typeof UserErrorCode];

/**
 * ユーザーに関するエラーコードの分類（ADR-004 決定 3）。
 *
 * HTTP の status とログのレベルは、この表から決まる。
 * 利用者にどう見せるかの表は `app/routes/_shared/user-error.server.ts` に定義する。
 */
export const userErrorKind: Record<UserErrorCode, ErrorKind> = {
  [UserErrorCode.NotFound]: ErrorKind.NotFound,
  [UserErrorCode.DatabaseError]: ErrorKind.Internal,
  [UserErrorCode.SessionNotFound]: ErrorKind.NotFound,
  [UserErrorCode.CurrentSession]: ErrorKind.Conflict,
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

/**
 * ログイン中の端末（INFO-011）を読む窓口 (ポート)。
 *
 * セッションのトークンは、ログアウトさせる処理の中でだけ使う。
 * 画面へは ID しか出さないので、ID からトークンを引くのはこの窓口の役目になる（実装課題 8）。
 */
export interface UserSessionRepository {
  /**
   * そのユーザー自身のセッションを ID で探し、トークンを返す。
   *
   * - 見つかった場合: ok(トークン)
   * - 無い場合と、他人のセッションだった場合: ok(null)。2 つを区別しない
   * - DB アクセスに失敗した場合: err(DATABASE_ERROR)
   */
  findOwnSessionToken(userId: string, sessionId: string): ResultAsync<string | null, UserError>;
}

/**
 * ログイン中の端末をログアウトさせる窓口 (ポート)。
 *
 * 実際に終わらせるのは Better Auth なので、infra ではなく `app/lib/auth/` が実装する。
 */
export interface SessionRevoker {
  /** トークンで指したセッションを終わらせる */
  revoke(token: string): ResultAsync<void, UserError>;
  /** 利用中の端末以外のセッションをすべて終わらせる */
  revokeOthers(): ResultAsync<void, UserError>;
}
