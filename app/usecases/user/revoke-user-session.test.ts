import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import {
  UserErrorCode,
  type SessionRevoker,
  type UserError,
  type UserSessionRepository,
} from "~/domain/user";
import { revokeOtherSessionsUseCase, revokeSessionUseCase } from "./revoke-user-session";

const userId = "usr_user_1";
const currentSessionId = "sess_current";

const dbError: UserError = {
  code: UserErrorCode.DatabaseError,
  message: "D1 に届かなかった。",
};

/** 引いたときに返すトークンを決めた偽物の Repository を作る */
const repositoryReturning = (
  result: ReturnType<UserSessionRepository["findOwnSessionToken"]>,
): UserSessionRepository => ({
  findOwnSessionToken: vi.fn(() => result),
});

const createRevoker = (): SessionRevoker => ({
  revoke: vi.fn(() => okAsync(undefined)),
  revokeOthers: vi.fn(() => okAsync(undefined)),
});

describe("revokeSessionUseCase", () => {
  it("ほかの端末なら、そのセッションのトークンで終わらせる", async () => {
    const userSessionRepository = repositoryReturning(okAsync("other_session_token"));
    const sessionRevoker = createRevoker();

    const result = await revokeSessionUseCase(
      { userSessionRepository, sessionRevoker },
      { userId, sessionId: "sess_other", currentSessionId },
    );

    expect(result.isOk()).toBe(true);
    // 持ち主の確かめは Repository が利用者の ID を条件に入れて行う
    expect(userSessionRepository.findOwnSessionToken).toHaveBeenCalledWith(userId, "sess_other");
    expect(sessionRevoker.revoke).toHaveBeenCalledWith("other_session_token");
  });

  it("利用中の端末なら、DB を引かずに CurrentSession で止める", async () => {
    const userSessionRepository = repositoryReturning(okAsync("current_token"));
    const sessionRevoker = createRevoker();

    const result = await revokeSessionUseCase(
      { userSessionRepository, sessionRevoker },
      { userId, sessionId: currentSessionId, currentSessionId },
    );

    expect(result._unsafeUnwrapErr().code).toBe(UserErrorCode.CurrentSession);
    expect(userSessionRepository.findOwnSessionToken).not.toHaveBeenCalled();
    expect(sessionRevoker.revoke).not.toHaveBeenCalled();
  });

  it("無いセッション（他人のセッションを含む）なら SessionNotFound にする", async () => {
    const userSessionRepository = repositoryReturning(okAsync(null));
    const sessionRevoker = createRevoker();

    const result = await revokeSessionUseCase(
      { userSessionRepository, sessionRevoker },
      { userId, sessionId: "sess_someone_else", currentSessionId },
    );

    expect(result._unsafeUnwrapErr().code).toBe(UserErrorCode.SessionNotFound);
    expect(sessionRevoker.revoke).not.toHaveBeenCalled();
  });

  it("DB の失敗は DatabaseError のまま返す", async () => {
    const userSessionRepository = repositoryReturning(errAsync(dbError));
    const sessionRevoker = createRevoker();

    const result = await revokeSessionUseCase(
      { userSessionRepository, sessionRevoker },
      { userId, sessionId: "sess_other", currentSessionId },
    );

    expect(result._unsafeUnwrapErr().code).toBe(UserErrorCode.DatabaseError);
    expect(sessionRevoker.revoke).not.toHaveBeenCalled();
  });

  it("終わらせるのに失敗したら、その失敗を返す", async () => {
    const userSessionRepository = repositoryReturning(okAsync("other_session_token"));
    const sessionRevoker: SessionRevoker = {
      ...createRevoker(),
      revoke: vi.fn(() => errAsync(dbError)),
    };

    const result = await revokeSessionUseCase(
      { userSessionRepository, sessionRevoker },
      { userId, sessionId: "sess_other", currentSessionId },
    );

    expect(result._unsafeUnwrapErr().code).toBe(UserErrorCode.DatabaseError);
  });
});

describe("revokeOtherSessionsUseCase", () => {
  it("利用中の端末以外をまとめて終わらせる", async () => {
    const sessionRevoker = createRevoker();

    const result = await revokeOtherSessionsUseCase({ sessionRevoker });

    expect(result.isOk()).toBe(true);
    expect(sessionRevoker.revokeOthers).toHaveBeenCalledOnce();
  });

  it("失敗したら、その失敗を返す", async () => {
    const sessionRevoker: SessionRevoker = {
      ...createRevoker(),
      revokeOthers: vi.fn(() => errAsync(dbError)),
    };

    const result = await revokeOtherSessionsUseCase({ sessionRevoker });

    expect(result._unsafeUnwrapErr().code).toBe(UserErrorCode.DatabaseError);
  });
});
