import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { InvitationStatus } from "~/domain/invitation";
import {
  StaffErrorCode,
  type StaffError,
  type StaffInvitation,
  type StaffInvitationRepository,
} from "~/domain/staff";
import { getStaffInvitationUseCase, type GetStaffInvitationArgs } from "./get-staff-invitation";

const testInvitationId = "sinv_123456";
const testEmail = "staff-invitee@ecs.osaka-u.ac.jp";
const baseNow = new Date("2026-04-01T10:00:00.000Z");

const validInvitation: StaffInvitation = {
  id: testInvitationId,
  email: testEmail,
  status: InvitationStatus.Pending,
  expiresAt: new Date("2026-04-03T10:00:00.000Z"),
  createdAt: new Date("2026-04-01T08:00:00.000Z"),
  inviterId: "usr_admin",
};

interface FakeStaffInvitationRepoOptions {
  readonly findByIdResult?: (
    invitationId: string,
  ) => ResultAsync<StaffInvitation | null, StaffError>;
}

const createFakeStaffInvitationRepository = (
  initialInvitation: StaffInvitation | null = validInvitation,
  options: FakeStaffInvitationRepoOptions = {},
) => {
  let findByIdCallCount = 0;
  let lastFindByIdId: string | null = null;

  const repository: StaffInvitationRepository = {
    findPendingByEmail: () =>
      errAsync({
        code: StaffErrorCode.DatabaseError,
        message: "findPendingByEmail is not used in this test",
      }),
    create: () =>
      errAsync({
        code: StaffErrorCode.DatabaseError,
        message: "create is not used in this test",
      }),
    cancel: () =>
      errAsync({
        code: StaffErrorCode.DatabaseError,
        message: "cancel is not used in this test",
      }),
    findById: (invitationId) => {
      findByIdCallCount += 1;
      lastFindByIdId = invitationId;
      if (options.findByIdResult) {
        return options.findByIdResult(invitationId);
      }
      return okAsync(initialInvitation);
    },
    accept: () =>
      errAsync({
        code: StaffErrorCode.DatabaseError,
        message: "accept is not used in this test",
      }),
    reject: () =>
      errAsync({
        code: StaffErrorCode.DatabaseError,
        message: "reject is not used in this test",
      }),
  };

  return {
    repository,
    findByIdCallCount: () => findByIdCallCount,
    lastFindByIdId: () => lastFindByIdId,
  };
};

const defaultArgs: GetStaffInvitationArgs = {
  invitationId: testInvitationId,
  actorEmail: testEmail,
  now: baseNow,
};

describe("getStaffInvitationUseCase", () => {
  it("承諾待ちかつ有効期限内かつ宛先一致の招待を正常に取得できる", async () => {
    const fakeRepo = createFakeStaffInvitationRepository();

    const result = await getStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      defaultArgs,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        invitationId: testInvitationId,
        expiresAt: validInvitation.expiresAt,
      });
    }
    expect(fakeRepo.findByIdCallCount()).toBe(1);
    expect(fakeRepo.lastFindByIdId()).toBe(testInvitationId);
  });

  it("前後に空白がある招待 ID は trim して検索される", async () => {
    const fakeRepo = createFakeStaffInvitationRepository();

    const result = await getStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      { ...defaultArgs, invitationId: `  ${testInvitationId}  ` },
    );

    expect(result.isOk()).toBe(true);
    expect(fakeRepo.lastFindByIdId()).toBe(testInvitationId);
  });

  it("空文字の招待 ID では DB を引かずに NotFound を返す（存在秘匿）", async () => {
    const fakeRepo = createFakeStaffInvitationRepository();

    const result = await getStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      { ...defaultArgs, invitationId: "   " },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvitationNotFound);
    }
    expect(fakeRepo.findByIdCallCount()).toBe(0);
  });

  it("招待が存在しない場合は NotFound を返す", async () => {
    const fakeRepo = createFakeStaffInvitationRepository(null);

    const result = await getStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      defaultArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvitationNotFound);
    }
  });

  it.each([InvitationStatus.Accepted, InvitationStatus.Rejected, InvitationStatus.Canceled])(
    "承諾待ち以外の招待状態 (%s) の場合は NotFound を返す",
    async (status) => {
      const fakeRepo = createFakeStaffInvitationRepository({
        ...validInvitation,
        status,
      });

      const result = await getStaffInvitationUseCase(
        { staffInvitationRepository: fakeRepo.repository },
        defaultArgs,
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(StaffErrorCode.InvitationNotFound);
        expect(result.error.message).toContain(status);
      }
    },
  );

  it("有効期限切れの招待の場合は NotFound を返す", async () => {
    const fakeRepo = createFakeStaffInvitationRepository({
      ...validInvitation,
      expiresAt: new Date(baseNow.getTime() - 1000),
    });

    const result = await getStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      defaultArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvitationNotFound);
      expect(result.error.message).toContain("有効期限が切れている");
    }
  });

  it("有効期限ちょうど（expiresAt === now）は切れている扱いとして NotFound を返す", async () => {
    const fakeRepo = createFakeStaffInvitationRepository({
      ...validInvitation,
      expiresAt: new Date(baseNow.getTime()),
    });

    const result = await getStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      defaultArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvitationNotFound);
    }
  });

  it("宛先が本人ではない招待の場合は InvitationNotVisible を返し、userMessage を持たない", async () => {
    const fakeRepo = createFakeStaffInvitationRepository({
      ...validInvitation,
      email: "other@ecs.osaka-u.ac.jp",
    });

    const result = await getStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      defaultArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvitationNotVisible);
      expect(result.error.userMessage).toBeUndefined();
    }
  });

  it("ログインユーザーのメールアドレスは大文字小文字を正規化して照合される", async () => {
    const fakeRepo = createFakeStaffInvitationRepository({
      ...validInvitation,
      email: "staff-invitee@ecs.osaka-u.ac.jp",
    });

    const result = await getStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      { ...defaultArgs, actorEmail: "Staff-Invitee@ECS.osaka-u.ac.jp" },
    );

    expect(result.isOk()).toBe(true);
  });

  it("リポジトリ層で DB エラーが発生した場合はそのまま返す", async () => {
    const dbError: StaffError = {
      code: StaffErrorCode.DatabaseError,
      message: "D1 error",
    };
    const fakeRepo = createFakeStaffInvitationRepository(null, {
      findByIdResult: () => errAsync(dbError),
    });

    const result = await getStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      defaultArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual(dbError);
    }
  });
});
