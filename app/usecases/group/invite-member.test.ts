import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vite-plus/test";

import type { AuditLogDraft } from "~/domain/audit-log";
import type { Group, GroupError } from "~/domain/group";
import { GroupErrorCode, GroupField, GroupStatus } from "~/domain/group";
import {
  INVITATION_EXPIRES_IN_HOURS,
  type CreateInvitationInput,
  type CreateInvitationOutcome,
  type Invitation,
} from "~/domain/invitation";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import type { StoredMembership, MembershipError } from "~/domain/membership";
import { MembershipErrorCode, MembershipRole } from "~/domain/membership";
import { fakeGroupRepository } from "~/testing/fakes/group";
import { fakeInvitationRepository } from "~/testing/fakes/invitation";
import { fakeMailOutboxNotifier } from "~/testing/fakes/mail";
import { fakeMembershipRepository } from "~/testing/fakes/membership";
import { inviteMemberUseCase, type InviteMemberArgs } from "./invite-member";

const testGroupId = "grp_robotics";

const testGroup: Group = {
  id: testGroupId,
  name: "ロボット工学研究会",
  status: GroupStatus.Enabled,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const adminMembership: StoredMembership = {
  id: "gm_adminMembership",
  groupId: testGroupId,
  userId: "usr_admin",
  role: MembershipRole.Admin,
};

const regularMember: StoredMembership = {
  id: "gm_regularMember",
  groupId: testGroupId,
  userId: "usr_member",
  role: MembershipRole.Member,
};

interface FakeGroupRepoOptions {
  readonly findByIdResult?: (id: string) => ResultAsync<Group, GroupError>;
}

const createFakeGroupRepository = (options: FakeGroupRepoOptions = {}) => {
  const findById = vi.fn((id: string) => {
    if (options.findByIdResult) {
      return options.findByIdResult(id);
    }
    if (id === testGroupId) {
      return okAsync(testGroup);
    }
    return errAsync({
      code: GroupErrorCode.NotFound,
      message: "Group not found",
    });
  });

  const repository = fakeGroupRepository({
    findById,
  });

  return {
    repository,
    findById,
  };
};

interface FakeMembershipRepoOptions {
  readonly findByGroupAndUserResult?: (
    groupId: string,
    userId: string,
  ) => ResultAsync<StoredMembership | null, MembershipError>;
  /** メールアドレス（小文字）から所属を引くときの表。宛先がすでにメンバーかの確認に使う */
  readonly membershipsByEmail?: Readonly<Record<string, StoredMembership>>;
  readonly findByGroupAndEmailResult?: (
    groupId: string,
    normalizedEmail: string,
  ) => ResultAsync<StoredMembership | null, MembershipError>;
}

const createFakeMembershipRepository = (
  initialMemberships: readonly StoredMembership[],
  options: FakeMembershipRepoOptions = {},
) => {
  const memberships = [...initialMemberships];

  const findByGroupAndUser = vi.fn((groupId: string, userId: string) => {
    if (options.findByGroupAndUserResult) {
      return options.findByGroupAndUserResult(groupId, userId);
    }
    const found = memberships.find((m) => m.groupId === groupId && m.userId === userId);
    return okAsync(found ?? null);
  });

  const findByGroupAndEmail = vi.fn((groupId: string, normalizedEmail: string) => {
    if (options.findByGroupAndEmailResult) {
      return options.findByGroupAndEmailResult(groupId, normalizedEmail);
    }
    const found = options.membershipsByEmail?.[normalizedEmail];
    return okAsync(found !== undefined && found.groupId === groupId ? found : null);
  });

  const repository = fakeMembershipRepository({
    findByGroupAndUser,
    findByGroupAndEmail,
  });

  return {
    repository,
    findByGroupAndUser,
    findByGroupAndEmail,
  };
};

interface FakeInvitationRepoOptions {
  readonly pendingInvitation?: Invitation | null;
  readonly createResult?: (
    input: CreateInvitationInput,
    mails: readonly MailDraft[],
    auditLog: AuditLogDraft,
  ) => ResultAsync<CreateInvitationOutcome, GroupError>;
}

const createFakeInvitationRepository = (options: FakeInvitationRepoOptions = {}) => {
  const findPendingByGroupAndEmail = vi.fn((_groupId: string, _email: string) => {
    return okAsync(options.pendingInvitation ?? null);
  });

  const create = vi.fn(
    (input: CreateInvitationInput, mails: readonly MailDraft[], auditLog: AuditLogDraft) => {
      if (options.createResult) {
        return options.createResult(input, mails, auditLog);
      }
      return okAsync({ enqueuedMailIds: ["mail_1"] });
    },
  );

  const repository = fakeInvitationRepository({
    findPendingByGroupAndEmail,
    create,
  });

  return {
    repository,
    findPendingByGroupAndEmail,
    create,
  };
};

const createFakeMailOutboxNotifier = (shouldThrow = false) => {
  const notifyEnqueued = vi.fn((_mailIds: readonly string[]) => {
    if (shouldThrow) {
      throw new Error("Simulated notifier error");
    }
  });

  const notifier = fakeMailOutboxNotifier({
    notifyEnqueued,
  });

  return {
    notifier,
    notifyEnqueued,
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
    expect(fakeInvitation.create).toHaveBeenCalledTimes(1);

    const [input] = fakeInvitation.create.mock.calls[0] ?? [];
    expect(input).toBeDefined();
    expect(input!.email).toBe("taro.handai@osaka-u.ac.jp");
    expect(input!.role).toBe(MembershipRole.Member);
    expect(input!.inviterUserId).toBe("usr_admin");
    expect(input!.expiresAt.getTime()).toBe(
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
    const [, mails] = fakeInvitation.create.mock.calls[0] ?? [];
    expect(mails).toBeDefined();
    expect(mails!.length).toBe(1);
    const createdInvitationId = result._unsafeUnwrap().invitationId;
    expect(mails![0].idempotencyKey).toBe(
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
    expect(fakeNotifier.notifyEnqueued).toHaveBeenCalledTimes(1);
    expect(fakeNotifier.notifyEnqueued.mock.calls[0]?.[0]).toEqual(["mail_abc_123"]);
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
    expect(fakeNotifier.notifyEnqueued).toHaveBeenCalledTimes(1);
  });

  // 5. 事務局スタッフは所属していなくても成功し、actedAsStaff が true になる（COND-012）
  it("事務局スタッフは所属していなくても成功し、actedAsStaff が true になる", async () => {
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
    // COND-030 (1): 事務局の画面からの操作では所属を引かない
    expect(fakeMembership.findByGroupAndUser).not.toHaveBeenCalled();
    expect(fakeInvitation.create).toHaveBeenCalledTimes(1);
    const auditLog = fakeInvitation.create.mock.calls[0]?.[2];
    expect(auditLog?.actedAsStaff).toBe(true);
  });

  // 6. 一般メンバー（member）が呼ぶと Forbidden
  it("一般メンバー（member）が呼ぶと Forbidden になる", async () => {
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
      expect(result.error.code).toBe(GroupErrorCode.Forbidden);
      expect(result.error.userMessage).toBe("メンバーの招待は、管理者と事務局のみ行えます。");
    }
    expect(fakeInvitation.create).not.toHaveBeenCalled();
  });

  // 7. 所属していない人が呼ぶと NotVisible（利用者への応答を 404 に揃えるのは画面の側。COND-011）
  it("所属していない人が呼ぶと NotVisible になり、画面に出す文言を持たない（COND-011）", async () => {
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
      expect(result.error.code).toBe(GroupErrorCode.NotVisible);
      expect(result.error.userMessage).toBeUndefined();
    }
    expect(fakeInvitation.create).not.toHaveBeenCalled();
  });

  // 8. groupId が空文字・空白のみのときは NotFound で、リポジトリが 1 つも呼ばれない
  it.each(["", "   "])(
    "groupId が %j のときは NotFound で、リポジトリが 1 つも呼ばれない",
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
        expect(result.error.code).toBe(GroupErrorCode.NotFound);
      }
      expect(fakeMembership.findByGroupAndUser).not.toHaveBeenCalled();
      expect(fakeGroup.findById).not.toHaveBeenCalled();
      expect(fakeInvitation.findPendingByGroupAndEmail).not.toHaveBeenCalled();
      expect(fakeInvitation.create).not.toHaveBeenCalled();
    },
  );

  // 9. 許可外ドメインのアドレスは InvalidInput で、認可のためのリポジトリ呼び出しが起きない
  it("許可外ドメインのアドレスは InvalidInput で、認可リポジトリの呼び出しが起きない", async () => {
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
      expect(result.error.code).toBe(GroupErrorCode.InvalidInput);
    }
    // 認可より前に入力を弾くため、所属確認は呼ばれない
    expect(fakeMembership.findByGroupAndUser).not.toHaveBeenCalled();
  });

  // 10. 役割が不正なら InvalidInput
  it.each(["owner", "ADMIN", "admin,member", "", " "])(
    "役割が %j のときは InvalidInput になる",
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
        expect(result.error.code).toBe(GroupErrorCode.InvalidInput);
        expect(result.error.userMessage).toBe("指定できない役割です。");
      }
      expect(fakeMembership.findByGroupAndUser).not.toHaveBeenCalled();
    },
  );

  // 11. 同じ宛先に有効な承諾待ちの招待があると InvalidInput で、create が呼ばれない
  it("同じ宛先に有効な承諾待ちの招待があると InvalidInput で、create が呼ばれない", async () => {
    const pendingInvitation: Invitation = {
      id: "inv_existing",
      groupId: testGroupId,
      email: "taro.handai@osaka-u.ac.jp",
      role: MembershipRole.Member,
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
      expect(result.error.code).toBe(GroupErrorCode.InvalidInput);
      expect(result.error.userMessage).toBe(
        "このメールアドレスには、すでに招待を送っています。取り消してから送り直してください。",
      );
    }
    expect(fakeInvitation.create).not.toHaveBeenCalled();
  });

  // 12. 同じ宛先の招待があっても期限切れなら成功し、create が呼ばれる
  it("同じ宛先の招待があっても期限切れなら成功し、create が呼ばれる", async () => {
    const expiredInvitation: Invitation = {
      id: "inv_expired",
      groupId: testGroupId,
      email: "taro.handai@osaka-u.ac.jp",
      role: MembershipRole.Member,
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
    expect(fakeInvitation.create).toHaveBeenCalledTimes(1);
  });

  // 13. 団体が見つからないときは NotFound（findById が失敗を返すケース）
  it("団体が見つからないときは NotFound になる", async () => {
    const fakeGroup = createFakeGroupRepository({
      findByIdResult: () =>
        errAsync({
          code: GroupErrorCode.NotFound,
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
      expect(result.error.code).toBe(GroupErrorCode.NotFound);
    }
    expect(fakeInvitation.create).not.toHaveBeenCalled();
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
    expect(fakeNotifier.notifyEnqueued).not.toHaveBeenCalled();
  });

  // 15. membershipRepository.findByGroupAndUser が DB エラーを返したら、NotFound に潰れず DatabaseError になる
  it("findByGroupAndUser が DB エラーを返したら、NotFound に潰れず DatabaseError になる", async () => {
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
      /*
       * 元の失敗を cause に残していることを確かめる。ここが落ちるとログに原因が残らない。
       * message の文言そのものは突き合わせない。ログにしか出ない文字列なので、
       * 書き換えるたびにこのテストが落ちても、守られたことは何も増えない。
       */
      expect(result.error.cause).toEqual({
        code: MembershipErrorCode.DatabaseError,
        message: "D1 connection failed",
      });
    }
    expect(fakeGroup.findById).not.toHaveBeenCalled();
    expect(fakeInvitation.create).not.toHaveBeenCalled();
  });

  // 16. 宛先がすでにこの団体のメンバーなら InvalidInput で、招待を作らない（COND-022）
  it("宛先がすでにこの団体のメンバーなら InvalidInput になり、create が呼ばれない", async () => {
    const existingMember: StoredMembership = {
      id: "gm_taro",
      groupId: testGroupId,
      userId: "usr_taro",
      role: MembershipRole.Member,
    };
    const fakeGroup = createFakeGroupRepository();
    const fakeMembership = createFakeMembershipRepository([adminMembership, existingMember], {
      membershipsByEmail: { "taro.handai@osaka-u.ac.jp": existingMember },
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
      validArgs, // 宛先は大文字まじりの "Taro.Handai@osaka-u.ac.jp"
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.InvalidInput);
      expect(result.error.field).toBe(GroupField.InviteeEmail);
      expect(result.error.userMessage).toBe(
        "このメールアドレスの方は、すでにこの団体のメンバーです。",
      );
      // 宛先のアドレスはログ用の説明に埋め込まない（ADR-004 決定 9）
      expect(result.error.message).not.toContain("taro.handai");
    }
    // 小文字にそろえたアドレスで、この団体に限って引く
    expect(
      fakeMembership.findByGroupAndEmail.mock.calls.map(([groupId, normalizedEmail]) => ({
        groupId,
        normalizedEmail,
      })),
    ).toEqual([{ groupId: testGroupId, normalizedEmail: "taro.handai@osaka-u.ac.jp" }]);
    expect(fakeInvitation.create).not.toHaveBeenCalled();
    expect(fakeNotifier.notifyEnqueued).not.toHaveBeenCalled();
  });

  // 17. 宛先が別の団体のメンバーであっても、この団体には招待できる
  it("宛先が別の団体のメンバーであっても、この団体には招待できる", async () => {
    const otherGroupMember: StoredMembership = {
      id: "gm_taro_other",
      groupId: "grp_other",
      userId: "usr_taro",
      role: MembershipRole.Admin,
    };
    const fakeGroup = createFakeGroupRepository();
    const fakeMembership = createFakeMembershipRepository([adminMembership, otherGroupMember], {
      membershipsByEmail: { "taro.handai@osaka-u.ac.jp": otherGroupMember },
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

    expect(result.isOk()).toBe(true);
    expect(fakeInvitation.create).toHaveBeenCalledTimes(1);
  });

  // 18. findByGroupAndEmail が DB エラーを返したら DatabaseError になり、招待を作らない
  it("findByGroupAndEmail が DB エラーを返したら DatabaseError になり、create が呼ばれない", async () => {
    const fakeGroup = createFakeGroupRepository();
    const fakeMembership = createFakeMembershipRepository([adminMembership], {
      findByGroupAndEmailResult: () =>
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
      expect(result.error.cause).toEqual({
        code: MembershipErrorCode.DatabaseError,
        message: "D1 connection failed",
      });
    }
    expect(fakeInvitation.create).not.toHaveBeenCalled();
  });
});
