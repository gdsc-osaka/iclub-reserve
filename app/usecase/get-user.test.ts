import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { User } from "~/domain/user";
import { UserErrorCode, databaseError } from "~/domain/user-error";
import type { UserRepository } from "~/domain/user-repository";
import { createGetUser } from "./get-user";

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
  findById: (id) => okAsync(users.find((user) => user.id === id)),
});

/** 必ず DB エラーを返すダミーのリポジトリ */
const createFailingUserRepository = (): UserRepository => ({
  findById: () => errAsync(databaseError(new Error("D1 との接続に失敗しました"))),
});

describe("createGetUser", () => {
  it("ID に一致するユーザーを返す", async () => {
    const getUser = createGetUser({
      userRepository: createFakeUserRepository([dummyUser]),
    });

    const result = await getUser({ userId: "user_1" });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(dummyUser);
  });

  it("ユーザーが存在しない場合は USER_NOT_FOUND を返す", async () => {
    const getUser = createGetUser({
      userRepository: createFakeUserRepository([dummyUser]),
    });

    const result = await getUser({ userId: "unknown" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(UserErrorCode.UserNotFound);
  });

  it("ID が空文字の場合は INVALID_USER_ID を返す", async () => {
    const getUser = createGetUser({
      userRepository: createFakeUserRepository([dummyUser]),
    });

    const result = await getUser({ userId: "   " });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(UserErrorCode.InvalidUserId);
  });

  it("DB アクセスに失敗した場合は DATABASE_ERROR がそのまま伝播する", async () => {
    const getUser = createGetUser({
      userRepository: createFailingUserRepository(),
    });

    const result = await getUser({ userId: "user_1" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(UserErrorCode.DatabaseError);
  });
});
