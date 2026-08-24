/** ユーザーに関するエラーの種類 */
export const UserErrorCode = {
  /** ユーザー ID の形式が不正 */
  InvalidUserId: "INVALID_USER_ID",
  /** 指定された ID のユーザーが存在しない */
  UserNotFound: "USER_NOT_FOUND",
  /** DB へのアクセスに失敗した */
  DatabaseError: "DATABASE_ERROR",
} as const;

export type UserErrorCode = (typeof UserErrorCode)[keyof typeof UserErrorCode];

/**
 * ユーザーに関するドメインエラー。
 * class (Error の継承) は使わず、ただのオブジェクトとして表現する。
 */
export interface UserError {
  readonly code: UserErrorCode;
  readonly message: string;
  /** 元となった例外。ログ出力用で、クライアントには返さない */
  readonly cause?: unknown;
}

/** ユーザー ID が不正な場合のエラーを作る */
export const invalidUserId = (): UserError => ({
  code: UserErrorCode.InvalidUserId,
  message: "ユーザー ID が指定されていません。",
});

/** ユーザーが見つからなかった場合のエラーを作る */
export const userNotFound = (id: string): UserError => ({
  code: UserErrorCode.UserNotFound,
  message: `ID が ${id} のユーザーは見つかりませんでした。`,
});

/** DB アクセスに失敗した場合のエラーを作る */
export const databaseError = (cause: unknown): UserError => ({
  code: UserErrorCode.DatabaseError,
  message: "ユーザー情報の取得に失敗しました。",
  cause,
});
