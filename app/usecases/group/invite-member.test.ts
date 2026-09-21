import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { Group, GroupError, GroupRepository, UpdateGroupNameInput } from "~/domain/group";
import { GroupErrorCode, GroupStatus } from "~/domain/group";
import {
  INVITATION_EXPIRES_IN_HOURS,
  type CreateInvitationInput,
  type CreateInvitationOutcome,
  type Invitation,
  type InvitationRepository,
} from "~/domain/invitation";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import type {
  Membership,
  MembershipError,
  MembershipRepository,
  UpdateMembershipRoleInput,
} from "~/domain/membership";
import { MembershipErrorCode, MembershipRole } from "~/domain/membership";
import { inviteMemberUseCase, type InviteMemberArgs } from "./invite-member";

const testGroupId = "grp_robotics";

const testGroup: Group = {
  id: testGroupId,
  name: "ロボット工学研究会",
  status: GroupStatus.Enabled,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const adminMembership: Membership = {
  groupId: testGroupId,
  userId: "usr_admin",
  roles: [MembershipRole.Admin],
};

const regularMember: Membership = {
  groupId: testGroupId,
  userId: "usr_member",
  roles: [MembershipRole.Member],
};

interface FakeGroupRepoOptions {
  readonly findByIdResult?: (id: string) => ResultAsync<Group, GroupError>;
}

const createFakeGroupRepository = (options: FakeGroupRepoOptions = {}) => {
  let findByIdCallCount = 0;
  const repository: GroupRepository = {
    findById: (id: string) => {
      findByIdCallCount += 1;
      if (options.findByIdResult) {
        return options.findByIdResult(id);
      }
      if (id === testGroupId) {
        return okAsync(testGroup);
      }
      return errAsync({
        code: GroupErrorCode.GroupNotFound,
        message: "Group not found",
      });
    },
    updateName: (_input: UpdateGroupNameInput) =>
      errAsync({
        code: GroupErrorCode.DatabaseError,
        message: "updateName is not used in this test",
      }),
  };

  return {
    repository,
    findByIdCallCount: () => findByIdCallCount,
  };
};

interface FakeMembershipRepoOptions {
  readonly findByGroupAndUserResult?: (
    groupId: string,
    userId: string,
  ) => ResultAsync<Membership | null, MembershipError>;
}

const createFakeMembershipRepository = (
  initialMemberships: readonly Membership[],
  options: FakeMembershipRepoOptions = {},
) => {
  let findByGroupAndUserCallCount = 0;
  const memberships = [...initialMemberships];

  const repository: MembershipRepository = {
    findByGroupAndUser: (groupId, userId) => {
      findByGroupAndUserCallCount += 1;
      if (options.findByGroupAndUserResult) {
        return options.findByGroupAndUserResult(groupId, userId);
      }
      const found = memberships.find((m) => m.groupId === groupId && m.userId === userId);
      return okAsync(found ?? null);
    },
    countAdmins: () =>
      errAsync({
        code: MembershipErrorCode.DatabaseError,
        message: "countAdmins is not used in this test",
      }),
    updateRole: (_input: UpdateMembershipRoleInput) =>
      errAsync({
        code: MembershipErrorCode.DatabaseError,
        message: "updateRole is not used in this test",
      }),
    remove: () =>
      errAsync({
        code: MembershipErrorCode.DatabaseError,
        message: "remove is not used in this test",
      }),
  };

  return {
    repository,
    findByGroupAndUserCallCount: () => findByGroupAndUserCallCount,
  };
};

interface FakeInvitationRepoOptions {
  readonly pendingInvitation?: Invitation | null;
  readonly createResult?: (
    input: CreateInvitationInput,
    mails: readonly MailDraft[],
  ) => ResultAsync<CreateInvitationOutcome, GroupError>;
}

const createFakeInvitationRepository = (options: FakeInvitationRepoOptions = {}) => {
  let findPendingCallCount = 0;
  let createCallCount = 0;
  let lastCreateInput: CreateInvitationInput | null = null;
  let lastCreateMails: readonly MailDraft[] | null = null;

  const repository: InvitationRepository = {
    findPendingByGroupAndEmail: (_groupId, _email) => {
      findPendingCallCount += 1;
      return okAsync(options.pendingInvitation ?? null);
    },
    create: (input, mails) => {
      createCallCount += 1;
      lastCreateInput = input;
      lastCreateMails = mails;
      if (options.createResult) {
        return options.createResult(input, mails);
      }
      return okAsync({ enqueuedMailIds: ["mail_1"] });
    },
    cancel: () =>
      errAsync({
        code: GroupErrorCode.DatabaseError,
        message: "cancel is not used in this test",
      }),
  };

  return {
    repository,
    findPendingCallCount: () => findPendingCallCount,
    createCallCount: () => createCallCount,
    lastCreateInput: () => lastCreateInput,
    lastCreateMails: () => lastCreateMails,
  };
};

const createFakeMailOutboxNotifier = (shouldThrow = false) => {
  let notifyEnqueuedCallCount = 0;
  let lastEnqueuedIds: readonly string[] | null = null;

  const notifier: MailOutboxNotifier = {
    notifyEnqueued: (mailIds: readonly string[]) => {
      notifyEnqueuedCallCount += 1;
      lastEnqueuedIds = mailIds;
      if (shouldThrow) {
        throw new Error("Simulated notifier error");
      }
    },
  };

  return {
    notifier,
    notifyEnqueuedCallCount: () => notifyEnqueuedCallCount,
    lastEnqueuedIds: () => lastEnqueuedIds,
  };
};

describe("inviteMemberUseCase", () => {
  const baseNow = new Date("2026-09-21T12:00:00.000Z");
  const validArgs: InviteMemberArgs = {
    groupId: testGroupId,
    actorUserId: "usr_admin",
    isStaff: false,
    email: "Taro.Handai@osaka-u.ac.jp",
    role: "member",
    now: baseNow,
    appBaseUrl: "https://example.com",
  };

  // 1. 管理者が有効なアドレスと役割を渡すと成功し、create に小文字アドレス・検証済み役割・48時間後期限が渡る
  it("管理者が有効なアドレスと役割を渡すと成功し、invitationRepository.create に小文字アドレス・役割・48時間後期限が渡る", async () => {
    const fakeGroup = createFakeGroupRepository();
    const fakeMembership = createFakeMembershipRepository([adminMembership]);
    const fakeInvitation = createFakeInvitationRepository();
    const fakeNotifier = createFakeMailOutboxNotifier();

    const result = await inviteMemberUseCase(
      {
        groupRepository: fakeGroup.repository,
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
        mailOutboxNotifier: fakeNotifier.notifier,
      },
      validArgs,
    );

    expect(result.isOk()).toBe(true);
    expect(fakeInvitation.createCallCount()).toBe(1);

    const input = fakeInvitation.lastCreateInput()!;
    expect(input.email).toBe("taro.handai@osaka-u.ac.jp");
    expect(input.role).toBe(MembershipRole.Member);
    expect(input.inviterUserId).toBe("usr_admin");
    expect(input.expiresAt.getTime()).toBe(
      baseNow.getTime() + INVITATION_EXPIRES_IN_HOURS * 60 * 60 * 1000,
    );
  });

  // 2. 成功したとき、create に渡った mails が 1 通で、idempotencyKey に招待 ID が入っている
  it("成功したとき、create に渡った mails が 1 通で、idempotencyKey に招待 ID が入っている", async () => {
    const fakeGroup = createFakeGroupRepository();
    const fakeMembership = createFakeMembershipRepository([adminMembership]);
    const fakeInvitation = createFakeInvitationRepository();
    const fakeNotifier = createFakeMailOutboxNotifier();

    const result = await inviteMemberUseCase(
      {
        groupRepository: fakeGroup.repository,
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
        mailOutboxNotifier: fakeNotifier.notifier,
      },
      validArgs,
    );

    expect(result.isOk()).toBe(true);
    const mails = fakeInvitation.lastCreateMails()!;
    expect(mails.length).toBe(1);
    const createdInvitationId = result._unsafeUnwrap().invitationId;
    expect(mails[0].idempotencyKey).toBe(
      `invitation:created:${createdInvitationId}:taro.handai@osaka-u.ac.jp`,
    );
  });

  // 3. 成功したとき、notifyEnqueued が create の返した ID で 1 回だけ呼ばれる
  it("成功したとき、notifyEnqueued が create の返した ID で 1 回だけ呼ばれる", async () => {
    const fakeGroup = createFakeGroupRepository();
    const fakeMembership = createFakeMembershipRepository([adminMembership]);
    const fakeInvitation = createFakeInvitationRepository({
      createResult: () => okAsync({ enqueuedMailIds: ["mail_abc_123"] }),
    });
    const fakeNotifier = createFakeMailOutboxNotifier();

    const result = await inviteMemberUseCase(
      {
        groupRepository: fakeGroup.repository,
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
        mailOutboxNotifier: fakeNotifier.notifier,
      },
      validArgs,
    );

    expect(result.isOk()).toBe(true);
    expect(fakeNotifier.notifyEnqueuedCallCount()).toBe(1);
    expect(fakeNotifier.lastEnqueuedIds()).toEqual(["mail_abc_123"]);
  });

  // 4. notifyEnqueued が例外を投げても、ユースケースは成功のまま返る
  it("notifyEnqueued が例外を投げても、ユースケースは成功のまま返る", async () => {
    const fakeGroup = createFakeGroupRepository();
    const fakeMembership = createFakeMembershipRepository([adminMembership]);
    const fakeInvitation = createFakeInvitationRepository();
    const fakeNotifier = createFakeMailOutboxNotifier(true); // 例外を投げる

    const result = await inviteMemberUseCase(
      {
        groupRepository: fakeGroup.repository,
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
        mailOutboxNotifier: fakeNotifier.notifier,
      },
      validArgs,
    );

    expect(result.isOk()).toBe(true);
    expect(fakeNotifier.notifyEnqueuedCallCount()).toBe(1);
  });

  // 5. 事務局スタッフは所属していなくても成功し、membershipRepository.findByGroupAndUser が呼ばれない
  it("事務局スタッフは所属していなくても成功し、findByGroupAndUser が呼ばれない", async () => {
    const fakeGroup = createFakeGroupRepository();
    const fakeMembership = createFakeMembershipRepository([]); // 所属なし
    const fakeInvitation = createFakeInvitationRepository();
    const fakeNotifier = createFakeMailOutboxNotifier();

    const result = await inviteMemberUseCase(
      {
        groupRepository: fakeGroup.repository,
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
        mailOutboxNotifier: fakeNotifier.notifier,
      },
      {
        ...validArgs,
        actorUserId: "usr_staff",
        isStaff: true,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fakeMembership.findByGroupAndUserCallCount()).toBe(0);
    expect(fakeInvitation.createCallCount()).toBe(1);
  });

  // 6. 一般メンバー（member）が呼ぶと GroupForbidden
  it("一般メンバー（member）が呼ぶと GroupForbidden になる", async () => {
    const fakeGroup = createFakeGroupRepository();
    const fakeMembership = createFakeMembershipRepository([regularMember]);
    const fakeInvitation = createFakeInvitationRepository();
    const fakeNotifier = createFakeMailOutboxNotifier();

    const result = await inviteMemberUseCase(
      {
        groupRepository: fakeGroup.repository,
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
        mailOutboxNotifier: fakeNotifier.notifier,
      },
      {
        ...validArgs,
        actorUserId: "usr_member",
      },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.GroupForbidden);
      expect(result.error.message).toBe("メンバーを招待できるのは管理者と事務局だけです。");
    }
    expect(fakeInvitation.createCallCount()).toBe(0);
  });

  // 7. 所属していない人が呼ぶと GroupNotFound で、メッセージまで「団体が存在しない」場合と同一（COND-011）
  it("所属していない人が呼ぶと GroupNotFound で、メッセージまで同一（COND-011）", async () => {
    const fakeGroup = createFakeGroupRepository();
    const fakeMembership = createFakeMembershipRepository([]); // 所属なし
    const fakeInvitation = createFakeInvitationRepository();
    const fakeNotifier = createFakeMailOutboxNotifier();

    const result = await inviteMemberUseCase(
      {
        groupRepository: fakeGroup.repository,
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
        mailOutboxNotifier: fakeNotifier.notifier,
      },
      {
        ...validArgs,
        actorUserId: "usr_stranger",
      },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.GroupNotFound);
      expect(result.error.message).toBe("グループが見つかりません。");
    }
    expect(fakeInvitation.createCallCount()).toBe(0);
  });

  // 8. groupId が空文字・空白のみのときは GroupNotFound で、リポジトリが 1 つも呼ばれない
  it.each(["", "   "])(
    "groupId が %j のときは GroupNotFound で、リポジトリが 1 つも呼ばれない",
    async (emptyGroupId) => {
      const fakeGroup = createFakeGroupRepository();
      const fakeMembership = createFakeMembershipRepository([adminMembership]);
      const fakeInvitation = createFakeInvitationRepository();
      const fakeNotifier = createFakeMailOutboxNotifier();

      const result = await inviteMemberUseCase(
        {
          groupRepository: fakeGroup.repository,
          membershipRepository: fakeMembership.repository,
          invitationRepository: fakeInvitation.repository,
          mailOutboxNotifier: fakeNotifier.notifier,
        },
        {
          ...validArgs,
          groupId: emptyGroupId,
        },
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(GroupErrorCode.GroupNotFound);
        expect(result.error.message).toBe("グループが見つかりません。");
      }
      expect(fakeMembership.findByGroupAndUserCallCount()).toBe(0);
      expect(fakeGroup.findByIdCallCount()).toBe(0);
      expect(fakeInvitation.findPendingCallCount()).toBe(0);
      expect(fakeInvitation.createCallCount()).toBe(0);
    },
  );

  // 9. 許可外ドメインのアドレスは GroupInvalidInput で、認可のためのリポジトリ呼び出しが起きない
  it("許可外ドメインのアドレスは GroupInvalidInput で、認可リポジトリの呼び出しが起きない", async () => {
    const fakeGroup = createFakeGroupRepository();
    const fakeMembership = createFakeMembershipRepository([adminMembership]);
    const fakeInvitation = createFakeInvitationRepository();
    const fakeNotifier = createFakeMailOutboxNotifier();

    const result = await inviteMemberUseCase(
      {
        groupRepository: fakeGroup.repository,
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
        mailOutboxNotifier: fakeNotifier.notifier,
      },
      {
        ...validArgs,
        email: "taro@gmail.com",
      },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.GroupInvalidInput);
    }
    // 認可より前に入力を弾くため、所属確認は呼ばれない
    expect(fakeMembership.findByGroupAndUserCallCount()).toBe(0);
  });

  // 10. 役割が不正なら GroupInvalidInput
  it.each(["owner", "ADMIN", "admin,member", "", " "])(
    "役割が %j のときは GroupInvalidInput になる",
    async (invalidRole) => {
      const fakeGroup = createFakeGroupRepository();
      const fakeMembership = createFakeMembershipRepository([adminMembership]);
      const fakeInvitation = createFakeInvitationRepository();
      const fakeNotifier = createFakeMailOutboxNotifier();

      const result = await inviteMemberUseCase(
        {
          groupRepository: fakeGroup.repository,
          membershipRepository: fakeMembership.repository,
          invitationRepository: fakeInvitation.repository,
          mailOutboxNotifier: fakeNotifier.notifier,
        },
        {
          ...validArgs,
          role: invalidRole,
        },
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(GroupErrorCode.GroupInvalidInput);
        expect(result.error.message).toBe("指定できない役割です。");
      }
      expect(fakeMembership.findByGroupAndUserCallCount()).toBe(0);
    },
  );

  // 11. 同じ宛先に有効な承諾待ちの招待があると GroupInvalidInput で、create が呼ばれない
  it("同じ宛先に有効な承諾待ちの招待があると GroupInvalidInput で、create が呼ばれない", async () => {
    const pendingInvitation: Invitation = {
      id: "inv_existing",
      groupId: testGroupId,
      email: "taro.handai@osaka-u.ac.jp",
      roles: [MembershipRole.Member],
      status: "pending",
      expiresAt: new Date(baseNow.getTime() + 1000 * 60 * 60), // 1時間後（有効期限内）
      createdAt: new Date(baseNow.getTime() - 1000 * 60 * 60),
      inviterUserId: "usr_admin",
    };

    const fakeGroup = createFakeGroupRepository();
    const fakeMembership = createFakeMembershipRepository([adminMembership]);
    const fakeInvitation = createFakeInvitationRepository({ pendingInvitation });
    const fakeNotifier = createFakeMailOutboxNotifier();

    const result = await inviteMemberUseCase(
      {
        groupRepository: fakeGroup.repository,
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
        mailOutboxNotifier: fakeNotifier.notifier,
      },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.GroupInvalidInput);
      expect(result.error.message).toBe(
        "このメールアドレスには、すでに招待を送っています。取り消してから送り直してください。",
      );
    }
    expect(fakeInvitation.createCallCount()).toBe(0);
  });

  // 12. 同じ宛先の招待があっても期限切れなら成功し、create が呼ばれる
  it("同じ宛先の招待があっても期限切れなら成功し、create が呼ばれる", async () => {
    const expiredInvitation: Invitation = {
      id: "inv_expired",
      groupId: testGroupId,
      email: "taro.handai@osaka-u.ac.jp",
      roles: [MembershipRole.Member],
      status: "pending",
      expiresAt: new Date(baseNow.getTime() - 1000 * 60), // 1分前（期限切れ）
      createdAt: new Date(baseNow.getTime() - 1000 * 60 * 60 * 50),
      inviterUserId: "usr_admin",
    };

    const fakeGroup = createFakeGroupRepository();
    const fakeMembership = createFakeMembershipRepository([adminMembership]);
    const fakeInvitation = createFakeInvitationRepository({
      pendingInvitation: expiredInvitation,
    });
    const fakeNotifier = createFakeMailOutboxNotifier();

    const result = await inviteMemberUseCase(
      {
        groupRepository: fakeGroup.repository,
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
        mailOutboxNotifier: fakeNotifier.notifier,
      },
      validArgs,
    );

    expect(result.isOk()).toBe(true);
    expect(fakeInvitation.createCallCount()).toBe(1);
  });

  // 13. 団体が見つからないときは GroupNotFound（findById が失敗を返すケース）
  it("団体が見つからないときは GroupNotFound になる", async () => {
    const fakeGroup = createFakeGroupRepository({
      findByIdResult: () =>
        errAsync({
          code: GroupErrorCode.GroupNotFound,
          message: "Group not found",
        }),
    });
    const fakeMembership = createFakeMembershipRepository([adminMembership]);
    const fakeInvitation = createFakeInvitationRepository();
    const fakeNotifier = createFakeMailOutboxNotifier();

    const result = await inviteMemberUseCase(
      {
        groupRepository: fakeGroup.repository,
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
        mailOutboxNotifier: fakeNotifier.notifier,
      },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.GroupNotFound);
    }
    expect(fakeInvitation.createCallCount()).toBe(0);
  });

  // 14. invitationRepository.create が DB エラーを返したら DatabaseError になり、notifyEnqueued が呼ばれない
  it("create が DB エラーを返したら DatabaseError になり、notifyEnqueued が呼ばれない", async () => {
    const fakeGroup = createFakeGroupRepository();
    const fakeMembership = createFakeMembershipRepository([adminMembership]);
    const fakeInvitation = createFakeInvitationRepository({
      createResult: () =>
        errAsync({
          code: GroupErrorCode.DatabaseError,
          message: "DB error",
        }),
    });
    const fakeNotifier = createFakeMailOutboxNotifier();

    const result = await inviteMemberUseCase(
      {
        groupRepository: fakeGroup.repository,
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
        mailOutboxNotifier: fakeNotifier.notifier,
      },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.DatabaseError);
    }
    expect(fakeNotifier.notifyEnqueuedCallCount()).toBe(0);
  });

  // 15. membershipRepository.findByGroupAndUser が DB エラーを返したら、GroupNotFound に潰れず DatabaseError になる
  it("findByGroupAndUser が DB エラーを返したら、GroupNotFound に潰れず DatabaseError になる", async () => {
    const fakeGroup = createFakeGroupRepository();
    const fakeMembership = createFakeMembershipRepository([adminMembership], {
      findByGroupAndUserResult: () =>
        errAsync({
          code: MembershipErrorCode.DatabaseError,
          message: "D1 connection failed",
        }),
    });
    const fakeInvitation = createFakeInvitationRepository();
    const fakeNotifier = createFakeMailOutboxNotifier();

    const result = await inviteMemberUseCase(
      {
        groupRepository: fakeGroup.repository,
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
        mailOutboxNotifier: fakeNotifier.notifier,
      },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.DatabaseError);
      expect(result.error.message).toBe("メンバー情報の処理に失敗しました。");
    }
    expect(fakeGroup.findByIdCallCount()).toBe(0);
    expect(fakeInvitation.createCallCount()).toBe(0);
  });
});
