import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import type { Group, GroupError } from "~/domain/group";
import { GroupErrorCode, GroupStatus } from "~/domain/group";
import type { Invitation } from "~/domain/invitation";
import { InvitationStatus } from "~/domain/invitation";
import { MembershipRole } from "~/domain/membership";
import { fakeGroupRepository } from "~/testing/fakes/group";
import { fakeInvitationRepository } from "~/testing/fakes/invitation";
import { getInvitationUseCase, type GetInvitationArgs } from "./get-invitation";

const testInvitationId = "inv_123456";
const testGroupId = "grp_robotics";
const testEmail = "student@ecs.osaka-u.ac.jp";
const baseNow = new Date("2026-04-01T10:00:00.000Z");

const validInvitation: Invitation = {
  id: testInvitationId,
  groupId: testGroupId,
  email: testEmail,
  role: MembershipRole.Member,
  status: InvitationStatus.Pending,
  expiresAt: new Date("2026-04-03T10:00:00.000Z"),
  createdAt: new Date("2026-04-01T08:00:00.000Z"),
  inviterUserId: "usr_admin",
};

const validGroup: Group = {
  id: testGroupId,
  name: "ロボティクス部",
  status: GroupStatus.Enabled,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

interface FakeInvitationRepoOptions {
  readonly findByIdResult?: (invitationId: string) => ResultAsync<Invitation | null, GroupError>;
}

const createFakeInvitationRepository = (
  initialInvitation: Invitation | null = validInvitation,
  options: FakeInvitationRepoOptions = {},
) => {
  const findById = vi.fn((invitationId: string) => {
    if (options.findByIdResult) {
      return options.findByIdResult(invitationId);
    }
    return okAsync(initialInvitation);
  });

  const repository = fakeInvitationRepository({
    findById,
  });

  return {
    repository,
    findById,
  };
};

interface FakeGroupRepoOptions {
  readonly findByIdResult?: (groupId: string) => ResultAsync<Group, GroupError>;
}

const createFakeGroupRepository = (
  initialGroup: Group = validGroup,
  options: FakeGroupRepoOptions = {},
) => {
  const findById = vi.fn((groupId: string) => {
    if (options.findByIdResult) {
      return options.findByIdResult(groupId);
    }
    return okAsync(initialGroup);
  });

  const repository = fakeGroupRepository({
    findById,
  });

  return {
    repository,
    findById,
  };
};

describe("getInvitationUseCase", () => {
  const validArgs: GetInvitationArgs = {
    invitationId: testInvitationId,
    actorEmail: testEmail,
    now: baseNow,
  };

  // 1. 有効な招待 → 団体名・役割・有効期限が返る
  it("有効な招待の場合、団体名・役割・有効期限が返る", async () => {
    const fakeInvitation = createFakeInvitationRepository();
    const fakeGroup = createFakeGroupRepository();

    const result = await getInvitationUseCase(
      {
        invitationRepository: fakeInvitation.repository,
        groupRepository: fakeGroup.repository,
      },
      validArgs,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        invitationId: testInvitationId,
        groupName: "ロボティクス部",
        role: MembershipRole.Member,
        expiresAt: validInvitation.expiresAt,
      });
    }
    expect(fakeInvitation.findById).toHaveBeenCalledTimes(1);
    expect(fakeInvitation.findById).toHaveBeenCalledWith(testInvitationId);
    expect(fakeGroup.findById).toHaveBeenCalledTimes(1);
    expect(fakeGroup.findById).toHaveBeenCalledWith(testGroupId);
  });

  // 2. 招待が無い（null）→ InvitationNotFound
  it("招待が無い（null）場合は InvitationNotFound になる", async () => {
    const fakeInvitation = createFakeInvitationRepository(null);
    const fakeGroup = createFakeGroupRepository();

    const result = await getInvitationUseCase(
      {
        invitationRepository: fakeInvitation.repository,
        groupRepository: fakeGroup.repository,
      },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.InvitationNotFound);
      // 扱えなかった理由はログ用の message にだけ書き、利用者に見せる理由は持たない
      expect(result.error.userMessage).toBeUndefined();
    }
  });

  // 3. status が canceled → InvitationNotFound
  it("status が canceled の場合は InvitationNotFound になる", async () => {
    const canceledInvitation: Invitation = {
      ...validInvitation,
      status: InvitationStatus.Canceled,
    };
    const fakeInvitation = createFakeInvitationRepository(canceledInvitation);
    const fakeGroup = createFakeGroupRepository();

    const result = await getInvitationUseCase(
      {
        invitationRepository: fakeInvitation.repository,
        groupRepository: fakeGroup.repository,
      },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.InvitationNotFound);
      expect(result.error.userMessage).toBeUndefined();
    }
  });

  // 4. status が accepted → InvitationNotFound
  it("status が accepted の場合は InvitationNotFound になる", async () => {
    const acceptedInvitation: Invitation = {
      ...validInvitation,
      status: InvitationStatus.Accepted,
    };
    const fakeInvitation = createFakeInvitationRepository(acceptedInvitation);
    const fakeGroup = createFakeGroupRepository();

    const result = await getInvitationUseCase(
      {
        invitationRepository: fakeInvitation.repository,
        groupRepository: fakeGroup.repository,
      },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.InvitationNotFound);
      expect(result.error.userMessage).toBeUndefined();
    }
  });

  // 5. 期限切れ（expiresAt が now より前）→ InvitationNotFound
  it("expiresAt が now より前の場合は InvitationNotFound になる", async () => {
    const expiredInvitation: Invitation = {
      ...validInvitation,
      expiresAt: new Date("2026-04-01T09:59:59.000Z"),
    };
    const fakeInvitation = createFakeInvitationRepository(expiredInvitation);
    const fakeGroup = createFakeGroupRepository();

    const result = await getInvitationUseCase(
      {
        invitationRepository: fakeInvitation.repository,
        groupRepository: fakeGroup.repository,
      },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.InvitationNotFound);
      expect(result.error.userMessage).toBeUndefined();
    }
  });

  // 6. 期限ちょうど（expiresAt === now）→ InvitationNotFound
  it("expiresAt が now と同じ時刻（期限ちょうど）の場合は切れている扱いとして InvitationNotFound になる", async () => {
    const exactExpiredInvitation: Invitation = {
      ...validInvitation,
      expiresAt: baseNow,
    };
    const fakeInvitation = createFakeInvitationRepository(exactExpiredInvitation);
    const fakeGroup = createFakeGroupRepository();

    const result = await getInvitationUseCase(
      {
        invitationRepository: fakeInvitation.repository,
        groupRepository: fakeGroup.repository,
      },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.InvitationNotFound);
      expect(result.error.userMessage).toBeUndefined();
    }
  });

  // 7. 宛先が違う → InvitationNotVisible、かつ groupRepository.findById が呼ばれない
  it("宛先が違う場合は InvitationNotVisible になり、groupRepository.findById が呼ばれない", async () => {
    const fakeInvitation = createFakeInvitationRepository();
    const fakeGroup = createFakeGroupRepository();

    const result = await getInvitationUseCase(
      {
        invitationRepository: fakeInvitation.repository,
        groupRepository: fakeGroup.repository,
      },
      {
        ...validArgs,
        actorEmail: "another@ecs.osaka-u.ac.jp",
      },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      // 利用者への応答を InvitationNotFound と揃えるのは画面の表で、ここでは正直に返す（ADR-004 決定 4）
      expect(result.error.code).toBe(GroupErrorCode.InvitationNotVisible);
      expect(result.error.userMessage).toBeUndefined();
    }
    // 存在秘匿のため、団体を引きに行かないこと
    expect(fakeGroup.findById).not.toHaveBeenCalled();
  });

  // 8. 宛先の大文字・前後の空白が違うだけ → 成功する
  it("宛先の大文字・前後の空白が違うだけでも正規化されて一致し、成功する", async () => {
    const fakeInvitation = createFakeInvitationRepository();
    const fakeGroup = createFakeGroupRepository();

    const result = await getInvitationUseCase(
      {
        invitationRepository: fakeInvitation.repository,
        groupRepository: fakeGroup.repository,
      },
      {
        ...validArgs,
        actorEmail: "  STUDENT@ECS.OSAKA-U.AC.JP  ",
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fakeGroup.findById).toHaveBeenCalledTimes(1);
  });

  // 9. findById が DB エラー → DatabaseError
  it("findById が DB エラーの場合は DatabaseError になる", async () => {
    const fakeInvitation = createFakeInvitationRepository(null, {
      findByIdResult: () =>
        errAsync({
          code: GroupErrorCode.DatabaseError,
          message: "Database failure",
        }),
    });
    const fakeGroup = createFakeGroupRepository();

    const result = await getInvitationUseCase(
      {
        invitationRepository: fakeInvitation.repository,
        groupRepository: fakeGroup.repository,
      },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.DatabaseError);
    }
  });

  // 10. 団体が NotFound → InvitationNotFound に畳まれる
  it("団体が NotFound の場合は InvitationNotFound に畳まれる", async () => {
    const fakeInvitation = createFakeInvitationRepository();
    const fakeGroup = createFakeGroupRepository(validGroup, {
      findByIdResult: () =>
        errAsync({
          code: GroupErrorCode.NotFound,
          message: "団体が見つからない。",
        }),
    });

    const result = await getInvitationUseCase(
      {
        invitationRepository: fakeInvitation.repository,
        groupRepository: fakeGroup.repository,
      },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.InvitationNotFound);
      expect(result.error.userMessage).toBeUndefined();
    }
  });
});
