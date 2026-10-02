import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import {
  GroupErrorCode,
  GroupStatus,
  type Group,
  type GroupError,
  type GroupRepository,
} from "~/domain/group";
import { MembershipRole, type Membership, type MembershipRepository } from "~/domain/membership";
import { changeGroupStatusUseCase, type ChangeGroupStatusDeps } from "./change-group-status";

const dummyNow = new Date("2026-09-23T12:00:00Z");

const createFakeGroup = (status: GroupStatus = GroupStatus.Pending): Group => ({
  id: "grp_01",
  name: "テスト開発サークル",
  status,
  createdAt: new Date("2026-09-20T10:00:00Z"),
  updatedAt: new Date("2026-09-20T10:00:00Z"),
});

const createDeps = (overrides?: {
  group?: Group | null;
  membership?: Membership | null;
  updateStatusResult?: Group | null;
  groupError?: GroupError;
}) => {
  const currentGroup = overrides?.group !== undefined ? overrides.group : createFakeGroup();

  const groupRepository: GroupRepository = {
    findById: vi.fn((_id: string) => {
      if (overrides?.groupError) return errAsync(overrides.groupError);
      if (currentGroup === null) {
        return errAsync({
          code: GroupErrorCode.NotFound,
          message: "団体が見つかりません。",
        });
      }
      return okAsync(currentGroup);
    }),
    updateName: vi.fn(),
    create: vi.fn(),
    updateStatus: vi.fn((input) => {
      if (overrides?.groupError) return errAsync(overrides.groupError);
      if (overrides?.updateStatusResult === null) {
        return errAsync({
          code: GroupErrorCode.InvalidTransition,
          message: "更新対象の団体が見つからないか、ステータスが競合しています。",
        });
      }
      return okAsync({
        ...currentGroup!,
        status: input.to,
        updatedAt: input.updatedAt,
      });
    }),
  };

  const membershipRepository: MembershipRepository = {
    findByGroupAndUser: vi.fn((_groupId: string, _userId: string) =>
      okAsync(overrides?.membership ?? null),
    ),
    countAdmins: vi.fn(),
    updateRole: vi.fn(),
    remove: vi.fn(),
  };

  return {
    deps: { groupRepository, membershipRepository } satisfies ChangeGroupStatusDeps,
    groupRepository,
    membershipRepository,
  };
};

describe("changeGroupStatusUseCase（UC-014: 団体の有効化・無効化）", () => {
  describe("事務局による有効な状態遷移（4 パターン）", () => {
    it.each([
      { from: GroupStatus.Pending, to: "enabled", expected: GroupStatus.Enabled },
      { from: GroupStatus.Pending, to: "disabled", expected: GroupStatus.Disabled },
      { from: GroupStatus.Enabled, to: "disabled", expected: GroupStatus.Disabled },
      { from: GroupStatus.Disabled, to: "enabled", expected: GroupStatus.Enabled },
    ])("$from から $to への変更が成功する", async ({ from, to, expected }) => {
      const { deps, groupRepository } = createDeps({ group: createFakeGroup(from) });

      const result = await changeGroupStatusUseCase(deps, {
        groupId: "grp_01",
        actorUserId: "usr_staff",
        isStaff: true,
        status: to,
        now: dummyNow,
      });

      expect(result.isOk()).toBe(true);
      const updated = result._unsafeUnwrap();
      expect(updated.status).toBe(expected);
      expect(groupRepository.updateStatus).toHaveBeenCalledWith({
        id: "grp_01",
        from,
        to: expected,
        updatedAt: dummyNow,
      });
    });
  });

  describe("許されない状態遷移の拒否", () => {
    it.each([
      { from: GroupStatus.Enabled, to: "enabled", reason: "同一状態への変更" },
      { from: GroupStatus.Disabled, to: "disabled", reason: "同一状態への変更" },
    ])("同一状態への変更は InvalidTransition（$from -> $to）", async ({ from, to }) => {
      const { deps, groupRepository } = createDeps({ group: createFakeGroup(from) });

      const result = await changeGroupStatusUseCase(deps, {
        groupId: "grp_01",
        actorUserId: "usr_staff",
        isStaff: true,
        status: to,
        now: dummyNow,
      });

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(GroupErrorCode.InvalidTransition);
      expect(error.userMessage).toBe("団体の状態が変わっています。画面を読み込み直してください。");
      expect(groupRepository.updateStatus).not.toHaveBeenCalled();
    });

    it("pending へは戻せない（変更先として受け付けず InvalidInput）", async () => {
      const { deps, groupRepository } = createDeps({ group: createFakeGroup(GroupStatus.Enabled) });

      const result = await changeGroupStatusUseCase(deps, {
        groupId: "grp_01",
        actorUserId: "usr_staff",
        isStaff: true,
        status: "pending",
        now: dummyNow,
      });

      expect(result.isErr()).toBe(true);
      // 変更先に指定できるのは "enabled" と "disabled" だけなので、団体を引く前の入力検証で止まる
      expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.InvalidInput);
      expect(groupRepository.findById).not.toHaveBeenCalled();
      expect(groupRepository.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe("競合制御（楽観的ロック失敗）", () => {
    it("先に別の操作でステータスが更新されていた場合は InvalidTransition を返す", async () => {
      const { deps } = createDeps({
        group: createFakeGroup(GroupStatus.Pending),
        updateStatusResult: null, // 0 行更新
      });

      const result = await changeGroupStatusUseCase(deps, {
        groupId: "grp_01",
        actorUserId: "usr_staff",
        isStaff: true,
        status: "enabled",
        now: dummyNow,
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.InvalidTransition);
    });
  });

  describe("認可と存在秘匿", () => {
    it("管理者は事務局ではないため Forbidden を返し、findById は呼ばれない", async () => {
      const { deps, groupRepository } = createDeps({
        membership: { groupId: "grp_01", userId: "usr_admin", role: MembershipRole.Admin },
      });

      const result = await changeGroupStatusUseCase(deps, {
        groupId: "grp_01",
        actorUserId: "usr_admin",
        isStaff: false,
        status: "enabled",
        now: dummyNow,
      });

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(GroupErrorCode.Forbidden);
      expect(error.userMessage).toBe("団体の有効化・無効化は事務局だけが行えます。");
      expect(groupRepository.findById).not.toHaveBeenCalled();
    });

    it("未所属の一般ユーザーには NotVisible を返し、findById は呼ばれない（COND-011）", async () => {
      const { deps, groupRepository } = createDeps({ membership: null });

      const result = await changeGroupStatusUseCase(deps, {
        groupId: "grp_01",
        actorUserId: "usr_other",
        isStaff: false,
        status: "enabled",
        now: dummyNow,
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.NotVisible);
      expect(groupRepository.findById).not.toHaveBeenCalled();
    });
  });

  describe("入力値の検証", () => {
    it("groupId が空の場合は groupNotFound() を返す", async () => {
      const { deps, groupRepository } = createDeps();

      const result = await changeGroupStatusUseCase(deps, {
        groupId: "   ",
        actorUserId: "usr_staff",
        isStaff: true,
        status: "enabled",
        now: dummyNow,
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.NotFound);
      expect(groupRepository.findById).not.toHaveBeenCalled();
    });

    it("不正な status 文字列の場合は InvalidInput を返す", async () => {
      const { deps, groupRepository } = createDeps();

      const result = await changeGroupStatusUseCase(deps, {
        groupId: "grp_01",
        actorUserId: "usr_staff",
        isStaff: true,
        status: "invalid_status",
        now: dummyNow,
      });

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(GroupErrorCode.InvalidInput);
      expect(error.userMessage).toBe("変更後の状態は「有効」または「無効」を指定してください。");
      expect(groupRepository.findById).not.toHaveBeenCalled();
    });
  });

  describe("エラー処理", () => {
    it("findById の DB エラーがそのまま伝播する", async () => {
      const { deps } = createDeps({
        groupError: {
          code: GroupErrorCode.DatabaseError,
          message: "DB エラー",
        },
      });

      const result = await changeGroupStatusUseCase(deps, {
        groupId: "grp_01",
        actorUserId: "usr_staff",
        isStaff: true,
        status: "enabled",
        now: dummyNow,
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.DatabaseError);
    });
  });
});
