import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { QueryErrorCode } from "~/query/error";
import type {
  UserReservationList,
  UserReservationListCriteria,
  UserReservationListQuery,
} from "~/query/user/user-reservation-list";
import {
  DEFAULT_PAST_RESERVATION_LIMIT,
  getUserReservationListUseCase,
} from "./get-user-reservation-list";

const now = new Date("2026-06-28T12:00:00+09:00");

const emptyList: UserReservationList = {
  groups: [],
  upcoming: [],
  past: [],
  isPastTruncated: false,
};

/**
 * D1 を使わないダミーの Query。
 *
 * 渡された引数を記録しておき、ユースケースが何をそのまま流し、
 * 何を補ってから渡しているのかを検証できるようにする。
 */
const createFakeQuery = () => {
  const calls: { userId: string; criteria: UserReservationListCriteria }[] = [];

  const query: UserReservationListQuery = {
    findByUserId: (userId, criteria) => {
      calls.push({ userId, criteria });

      return okAsync(emptyList);
    },
  };

  return { query, calls };
};

/** 必ず DB エラーを返すダミーの Query */
const createFailingQuery = (): UserReservationListQuery => ({
  findByUserId: () =>
    errAsync({
      code: QueryErrorCode.DatabaseError,
      message: "予約一覧の取得に失敗しました。",
      cause: new Error("D1 との接続に失敗しました"),
    }),
});

describe("getUserReservationListUseCase", () => {
  it("閲覧者の ID と基準時刻をそのまま Query へ渡す", async () => {
    const fake = createFakeQuery();

    const result = await getUserReservationListUseCase(
      { userReservationListQuery: fake.query },
      { viewerUserId: "usr_student_01", now },
    );

    expect(result.isOk()).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].userId).toBe("usr_student_01");
    expect(fake.calls[0].criteria.now).toBe(now);
  });

  it("履歴の件数を省略したら既定値を使う", async () => {
    const fake = createFakeQuery();

    await getUserReservationListUseCase(
      { userReservationListQuery: fake.query },
      { viewerUserId: "usr_student_01", now },
    );

    expect(fake.calls[0].criteria.pastLimit).toBe(DEFAULT_PAST_RESERVATION_LIMIT);
  });

  it("履歴の件数を指定できる", async () => {
    const fake = createFakeQuery();

    await getUserReservationListUseCase(
      { userReservationListQuery: fake.query },
      { viewerUserId: "usr_student_01", now, pastLimit: 5 },
    );

    expect(fake.calls[0].criteria.pastLimit).toBe(5);
  });

  it.each([0, -1, 0.5])("履歴の件数に %o が渡されたら既定値へ寄せる", async (pastLimit) => {
    const fake = createFakeQuery();

    await getUserReservationListUseCase(
      { userReservationListQuery: fake.query },
      { viewerUserId: "usr_student_01", now, pastLimit },
    );

    // そのまま LIMIT に渡すと 0 件しか返らない・SQL が壊れるといった形で表に出る
    expect(fake.calls[0].criteria.pastLimit).toBe(DEFAULT_PAST_RESERVATION_LIMIT);
  });

  it.each(["", "   "])(
    "閲覧者の ID が %o のときは何も問い合わせずに終わる",
    async (viewerUserId) => {
      const fake = createFakeQuery();

      const result = await getUserReservationListUseCase(
        { userReservationListQuery: fake.query },
        { viewerUserId, now },
      );

      expect(result.isErr()).toBe(true);
      // 空の一覧を返してしまうと、不具合が「予約がありません」に化けて気づけなくなる
      expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
      expect(fake.calls).toHaveLength(0);
    },
  );

  it("Query の失敗はそのまま伝播する", async () => {
    const result = await getUserReservationListUseCase(
      { userReservationListQuery: createFailingQuery() },
      { viewerUserId: "usr_student_01", now },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.DatabaseError);
  });
});
