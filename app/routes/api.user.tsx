import { env } from "cloudflare:workers";

import type { User } from "~/domain/user";
import type { UserError } from "~/domain/user-error";
import { UserErrorCode } from "~/domain/user-error";
import { createDb } from "~/infra/db";
import { createUserRepository } from "~/infra/user-repository";
import { createGetUser } from "~/usecase/get-user";
import type { Route } from "./+types/api.user";

/**
 * クライアントへ返すユーザー情報。
 * Date は JSON で扱えないため、ISO 8601 形式の文字列に変換して返す。
 */
interface UserResponse {
  id: string;
  email: string;
  name: string;
  isStaff: boolean;
  createdAt: string;
  updatedAt: string;
}

const toUserResponse = (user: User): UserResponse => ({
  id: user.id,
  email: user.email,
  name: user.name,
  isStaff: user.isStaff,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});

/** ドメインのエラーを HTTP ステータスコードに対応付ける */
const toStatusCode = (error: UserError): number => {
  switch (error.code) {
    case UserErrorCode.InvalidUserId:
      return 400;
    case UserErrorCode.UserNotFound:
      return 404;
    case UserErrorCode.DatabaseError:
      return 500;
  }
};

/** エラーをレスポンスに変換する。cause は内部情報なのでクライアントには返さない */
const toErrorResponse = (error: UserError): Response => {
  if (error.cause !== undefined) {
    console.error(`[${error.code}]`, error.cause);
  }

  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status: toStatusCode(error) },
  );
};

/**
 * ユーザー ID を指定して、そのユーザーの情報を取得するサーバーアクション。
 *
 * POST /api/users/:userId
 *
 * この関数は各層を組み立てる「配線」だけを担当し、
 * 業務ロジックそのものは usecase 層に置いている。
 *
 * NOTE: 認証は未導入のため、現時点では誰でも呼び出せる。
 */
export const action = ({ params }: Route.ActionArgs) => {
  // infra 層の実装を組み立てて、usecase に渡す
  const db = createDb(env.DB);
  const getUser = createGetUser({ userRepository: createUserRepository(db) });

  // match で成功・失敗の両方を必ず処理する
  return getUser({ userId: params.userId }).match(
    (user) => Response.json({ user: toUserResponse(user) }),
    toErrorResponse,
  );
};
