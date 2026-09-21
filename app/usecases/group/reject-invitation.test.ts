import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { GroupError } from "~/domain/group";
import { GroupErrorCode } from "~/domain/group";
import type { Invitation, InvitationRepository, RejectInvitationInput } from "~/domain/invitation";
import { rejectInvitationUseCase, type RejectInvitationArgs } from "./reject-invitation";

const testInvitationId = "inv_123456";
const testEmail = "student@ecs.osaka-u.ac.jp";
const baseNow = new Date("2026-04-01T10:00:00.000Z");

interface FakeInvitationRepoOptions {
  readonly rejectResult?: (input: RejectInvitationInput) => ResultAsync<number, GroupError>;
  readonly findByIdResult?: (invitationId: string) => ResultAsync<Invitation | null, GroupError>;
}

const createFakeInvitationRepository = (options: FakeInvitationRepoOptions = {}) => {
  let rejectCallCount = 0;
  let lastRejectInput: RejectInvitationInput | null = null;
  let findByIdCallCount = 0;

  const repository: InvitationRepository = {
    findPendingByGroupAndEmail: () =>
      errAsync({
        code: GroupErrorCode.DatabaseError,
        message: "findPendingByGroupAndEmail is not used in this test",
      }),
    create: () =>
      errAsync({
        code: GroupErrorCode.DatabaseError,
        message: "create is not used in this test",
      }),
    cancel: () =>
      errAsync({
        code: GroupErrorCode.DatabaseError,
        message: "cancel is not used in this test",
      }),
    findById: (invitationId) => {
      findByIdCallCount += 1;
      if (options.findByIdResult) {
        return options.findByIdResult(invitationId);
      }
      return errAsync({
        code: GroupErrorCode.DatabaseError,
        message: "findById should not be called",
      });
    },
    accept: () =>
      errAsync({
        code: GroupErrorCode.DatabaseError,
        message: "accept is not used in this test",
      }),
    reject: (input) => {
      rejectCallCount += 1;
      lastRejectInput = input;
      if (options.rejectResult) {
        return options.rejectResult(input);
      }
      return okAsync(1);
    },
  };

  return {
    repository,
    rejectCallCount: () => rejectCallCount,
    lastRejectInput: () => lastRejectInput,
    findByIdCallCount: () => findByIdCallCount,
  };
};

describe("rejectInvitationUseCase", () => {
  const validArgs: RejectInvitationArgs = {
    invitationId: testInvitationId,
    actorEmail: testEmail,
    now: baseNow,
  };

  // 1. 成功 → null が返る
  it("成功時に null が返る", async () => {
    const fakeInvitation = createFakeInvitationRepository();

    const result = await rejectInvitationUseCase(
      { invitationRepository: fakeInvitation.repository },
      validArgs,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
  });

  // 2. reject に渡る引数を確かめる
  it("reject に正しい引数が渡り、email が正規化されている", async () => {
    const fakeInvitation = createFakeInvitationRepository();

    await rejectInvitationUseCase(
      { invitationRepository: fakeInvitation.repository },
      {
        ...validArgs,
        actorEmail: "  STUDENT@ECS.OSAKA-U.AC.JP  ",
      },
    );

    expect(fakeInvitation.rejectCallCount()).toBe(1);
    const input = fakeInvitation.lastRejectInput();
    expect(input).not.toBeNull();
    expect(input?.invitationId).toBe(testInvitationId);
    expect(input?.email).toBe(testEmail);
    expect(input?.now).toBe(baseNow);
  });

  // 3. reject が 0 件 → InvitationNotFound
  it("reject が 0 件を返した場合は InvitationNotFound になる", async () => {
    const fakeInvitation = createFakeInvitationRepository({
      rejectResult: () => okAsync(0),
    });

    const result = await rejectInvitationUseCase(
      { invitationRepository: fakeInvitation.repository },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.InvitationNotFound);
      expect(result.error.message).toBe("招待が見つかりません。");
    }
  });

  // 4. invitationId が空文字・空白のみ → InvitationNotFound で、reject が呼ばれない
  it.each(["", "   "])(
    "invitationId が %j のときは InvitationNotFound になり、reject が呼ばれない",
    async (emptyId) => {
      const fakeInvitation = createFakeInvitationRepository();

      const result = await rejectInvitationUseCase(
        { invitationRepository: fakeInvitation.repository },
        { ...validArgs, invitationId: emptyId },
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(GroupErrorCode.InvitationNotFound);
        expect(result.error.message).toBe("招待が見つかりません。");
      }
      expect(fakeInvitation.rejectCallCount()).toBe(0);
    },
  );

  // 5. reject が DB エラー → DatabaseError
  it("reject が DB エラーを返した場合は DatabaseError になる", async () => {
    const fakeInvitation = createFakeInvitationRepository({
      rejectResult: () =>
        errAsync({
          code: GroupErrorCode.DatabaseError,
          message: "DB connection failed",
        }),
    });

    const result = await rejectInvitationUseCase(
      { invitationRepository: fakeInvitation.repository },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.DatabaseError);
      expect(result.error.message).toBe("DB connection failed");
    }
  });

  // 6. findById が 1 度も呼ばれない（事前 SELECT をしていないことの確認）
  it("事前 SELECT を行わず、findById が 1 度も呼ばれない", async () => {
    const fakeInvitation = createFakeInvitationRepository();

    await rejectInvitationUseCase({ invitationRepository: fakeInvitation.repository }, validArgs);

    expect(fakeInvitation.findByIdCallCount()).toBe(0);
  });
});
