import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vite-plus/test";

import type { CreateGroupInput, Group, GroupError } from "~/domain/group";
import { GroupErrorCode, GroupStatus } from "~/domain/group";
import { fakeGroupRepository } from "~/testing/fakes/group";
import { createGroupUseCase } from "./create-group";

interface FakeGroupRepositoryOptions {
  readonly createResult?: (input: CreateGroupInput) => ResultAsync<Group, GroupError>;
}

const createFakeGroupRepository = (options: FakeGroupRepositoryOptions = {}) => {
  const create = vi.fn((input: CreateGroupInput) => {
    if (options.createResult) {
      return options.createResult(input);
    }
    return okAsync({
      id: input.id,
      name: input.name,
      status: GroupStatus.Pending,
      createdAt: input.now,
      updatedAt: input.now,
    });
  });

  const repository = fakeGroupRepository({
    create,
  });

  return {
    repository,
    create,
  };
};

describe("createGroupUseCase", () => {
  const baseNow = new Date("2026-09-22T10:00:00.000Z");
  const actorUserId = "usr_creator";

  // 1. 団体名が空文字・空白のみのときは InvalidInput になり、create は 1 回も呼ばれない
  it.each(["", "   ", "　"])(
    "団体名が %o のときは InvalidInput になり、create は呼ばれない",
    async (name) => {
      const groups = createFakeGroupRepository();

      const result = await createGroupUseCase(
        { groupRepository: groups.repository },
        { actorUserId, name, now: baseNow },
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.InvalidInput);
      expect(groups.create).not.toHaveBeenCalled();
    },
  );

  // 2. 団体名が 64 文字を超えるときは InvalidInput になり、create は呼ばれない
  it("団体名が 64 文字を超えるときは InvalidInput になり、create は呼ばれない", async () => {
    const groups = createFakeGroupRepository();

    const result = await createGroupUseCase(
      { groupRepository: groups.repository },
      { actorUserId, name: "あ".repeat(65), now: baseNow },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.InvalidInput);
    expect(groups.create).not.toHaveBeenCalled();
  });

  // 3. 団体名に改行を含むときは InvalidInput になり、create は呼ばれない
  it.each(["ロボティクス\nプロジェクト", "ロボティクス\r\nプロジェクト"])(
    "団体名に改行を含むときは InvalidInput になり、create は呼ばれない",
    async (name) => {
      const groups = createFakeGroupRepository();

      const result = await createGroupUseCase(
        { groupRepository: groups.repository },
        { actorUserId, name, now: baseNow },
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.InvalidInput);
      expect(groups.create).not.toHaveBeenCalled();
    },
  );

  // 4. 正常系: create がちょうど 1 回呼ばれ、前後の空白がトリムされ、引数が正しく渡る
  it("正常系: create がちょうど 1 回呼ばれ、トリムされた名前・actorUserId・now・互いに異なる有効な ID が渡る", async () => {
    const groups = createFakeGroupRepository();

    const result = await createGroupUseCase(
      { groupRepository: groups.repository },
      { actorUserId, name: "  ロボティクス部  ", now: baseNow },
    );

    expect(result.isOk()).toBe(true);
    expect(groups.create).toHaveBeenCalledTimes(1);

    const input = groups.create.mock.calls[0]?.[0];
    expect(input).not.toBeNull();
    expect(input?.name).toBe("ロボティクス部");
    expect(input?.ownerUserId).toBe(actorUserId);
    expect(input?.now).toEqual(baseNow);
    expect(input?.id).toBeTruthy();
    expect(input?.membershipId).toBeTruthy();
    expect(input?.id).not.toBe(input?.membershipId);
  });

  // 5. 正常系: 返ってきた Group の status が GroupStatus.Pending である
  it("正常系: 作成された Group の status は Pending である（STATE-002）", async () => {
    const groups = createFakeGroupRepository();

    const result = await createGroupUseCase(
      { groupRepository: groups.repository },
      { actorUserId, name: "航空宇宙研究会", now: baseNow },
    );

    expect(result.isOk()).toBe(true);
    const createdGroup = result._unsafeUnwrap();
    expect(createdGroup.status).toBe(GroupStatus.Pending);
    expect(createdGroup.name).toBe("航空宇宙研究会");
  });

  // 6. create が DatabaseError を返したときは、その GroupError がそのまま伝わる
  it("create が DatabaseError を返したときは、そのエラーがそのまま返る", async () => {
    const dbError: GroupError = {
      code: GroupErrorCode.DatabaseError,
      message: "DB 書き込みエラー",
      cause: new Error("D1 connection lost"),
    };
    const groups = createFakeGroupRepository({
      createResult: () => errAsync(dbError),
    });

    const result = await createGroupUseCase(
      { groupRepository: groups.repository },
      { actorUserId, name: "新規団体", now: baseNow },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual(dbError);
    expect(groups.create).toHaveBeenCalledTimes(1);
  });
});
