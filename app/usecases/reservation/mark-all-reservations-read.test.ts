import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { ReservationErrorCode } from "~/domain/reservation";
import { QueryErrorCode } from "~/query/error";
import { fakeGroupUnreadUpdatesQuery, fakeReservationReadRepository } from "~/testing/fakes";
import { markAllReservationsReadUseCase } from "./mark-all-reservations-read";

const now = new Date("2026-10-14T15:00:00+09:00");

const buildDeps = (unreadIds: readonly string[]) => {
  const upsertMany = vi.fn().mockReturnValue(okAsync(undefined));
  const reservationReadRepository = fakeReservationReadRepository({
    upsertMany,
  });
  const groupUnreadUpdatesQuery = fakeGroupUnreadUpdatesQuery({
    findUnreadForUser: vi
      .fn()
      .mockReturnValue(
        okAsync({ items: [], overflowCount: 0, allUnreadReservationIds: unreadIds }),
      ),
  });
  return { deps: { reservationReadRepository, groupUnreadUpdatesQuery }, upsertMany };
};

describe("markAllReservationsReadUseCase", () => {
  it("送られてきた予約のうち、今も未読のものをまとめて既読にする", async () => {
    const { deps, upsertMany } = buildDeps(["res_001", "res_002", "res_003"]);

    const result = await markAllReservationsReadUseCase(deps, {
      actorUserId: "usr_reader",
      reservationIds: ["res_001", "res_002"],
      now,
    });

    expect(result.isOk()).toBe(true);
    // 一覧に出ていなかった res_003 は既読にしない
    expect(upsertMany).toHaveBeenCalledWith("usr_reader", ["res_001", "res_002"], now);
  });

  it("本人の未読に無い予約（見られない予約など）は既読の記録を作らない", async () => {
    const { deps, upsertMany } = buildDeps(["res_001"]);

    const result = await markAllReservationsReadUseCase(deps, {
      actorUserId: "usr_reader",
      reservationIds: ["res_001", "res_other_group", "res_001"],
      now,
    });

    expect(result.isOk()).toBe(true);
    // 重複も 1 件にまとめる
    expect(upsertMany).toHaveBeenCalledWith("usr_reader", ["res_001"], now);
  });

  it("未読を読み取れなければ DatabaseError を返し、書き込まない", async () => {
    const { deps, upsertMany } = buildDeps([]);
    deps.groupUnreadUpdatesQuery.findUnreadForUser = vi
      .fn()
      .mockReturnValue(errAsync({ code: QueryErrorCode.DatabaseError, message: "boom" }));

    const result = await markAllReservationsReadUseCase(deps, {
      actorUserId: "usr_reader",
      reservationIds: ["res_001"],
      now,
    });

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.DatabaseError);
    expect(upsertMany).not.toHaveBeenCalled();
  });
});
