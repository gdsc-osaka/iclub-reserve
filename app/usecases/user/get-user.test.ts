import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { User, UserRepository } from "~/domain/user";
import { UserErrorCode } from "~/domain/user";
import { getUserUseCase } from "./get-user";

const dummyUser: User = {
  id: "user_1",
  email: "taro@example.com",
  name: "山田 太郎",
  isStaff: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

/** D1 を使わないダミーのリポジトリ。渡した users の中から ID で検索する */
const createFakeUserRepository = (users: User[]): UserRepository => ({
  findById: (id) => {
    const found = users.find((user) => user.id === id);

    if (found === undefined) {
      return errAsync({
        code: UserErrorCode.UserNotFound,
        message: `ID が ${id} のユーザーは見つかりませんでした。`,
      });
    }

    return okAsync(found);
  },
});

/** 必ず DB エラーを返すダミーのリポジトリ */
const createFailingUserRepository = (): UserRepository => ({
  findById: () =>
    errAsync({
      code: UserErrorCode.DatabaseError,
      message: "ユーザー情報の取得に失敗しました。",
      cause: new Error("D1 との接続に失敗しました"),
    }),
});

describe("getUserUseCase", () => {
  it("ID に一致するユーザーを返す", async () => {
    const result = await getUserUseCase(
      { userRepository: createFakeUserRepository([dummyUser]) },
      { userId: "user_1" },
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(dummyUser);
  });

  it("ユーザーが存在しない場合は USER_NOT_FOUND がそのまま伝播する", async () => {
    const result = await getUserUseCase(
      { userRepository: createFakeUserRepository([dummyUser]) },
      { userId: "unknown" },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(UserErrorCode.UserNotFound);
  });

  it("DB アクセスに失敗した場合は DATABASE_ERROR がそのまま伝播する", async () => {
    const result = await getUserUseCase(
      { userRepository: createFailingUserRepository() },
      { userId: "user_1" },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(UserErrorCode.DatabaseError);
  });
});
