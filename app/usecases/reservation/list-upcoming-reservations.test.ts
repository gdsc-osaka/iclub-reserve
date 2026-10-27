import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vite-plus/test";

import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus, UPCOMING_RESERVATIONS_LIMIT } from "~/domain/reservation";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { ReservationListRow } from "~/query/reservation/reservation-list";
import type { UserGroupList } from "~/query/user/user-group-list";
import { fakeReservationListQuery, fakeUserGroupListQuery } from "~/testing/fakes";
import { listUpcomingReservationsUseCase } from "./list-upcoming-reservations";

describe("listUpcomingReservationsUseCase", () => {
  const now = new Date("2026-10-15T10:00:00.000Z");

  const createMockGroupListQuery = (groups: UserGroupList) =>
    fakeUserGroupListQuery({
      findByUserId: () => okAsync(groups),
    });

  it("所属団体が 0 件のときは予約を検索せずに空配列を返す", async () => {
    const findList = vi.fn(() => okAsync([]));
    const reservationListQuery = fakeReservationListQuery({ findList });

    const result = await listUpcomingReservationsUseCase(
      {
        userGroupListQuery: createMockGroupListQuery([]),
        reservationListQuery,
      },
      { actorUserId: "usr_1", now },
    );

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toEqual([]);
    expect(findList).not.toHaveBeenCalled();
  });

  it("所属する全団体の ID と条件（仮予約・承認済み、現在以降、開始昇順、上限5件）を渡して予約を取得する", async () => {
    const groups: UserGroupList = [
      {
        id: "grp_1",
        name: "団体A",
        status: GroupStatus.Enabled,
        role: MembershipRole.Admin,
        memberCount: 3,
      },
      {
        id: "grp_2",
        name: "団体B",
        status: GroupStatus.Enabled,
        role: MembershipRole.Member,
        memberCount: 5,
      },
    ];

    const mockRow: ReservationListRow = {
      id: "res_1",
      groupId: "grp_1",
      groupName: "団体A",
      facilityId: "fac_1",
      facilityName: "会議室A",
      startAt: new Date("2026-10-16T10:00:00.000Z"),
      endAt: new Date("2026-10-16T12:00:00.000Z"),
      status: ReservationStatus.Approved,
      statusReason: null,
      headCount: 4,
      note: "ミーティング",
      createdByName: "ユーザー1",
      requestedAt: new Date("2026-10-10T10:00:00.000Z"),
      hasApprovedOverlap: false,
      hasProvisionalOverlap: false,
    };

    const findList = vi.fn((_args: unknown) => okAsync([mockRow]));
    const reservationListQuery = fakeReservationListQuery({ findList });

    const result = await listUpcomingReservationsUseCase(
      {
        userGroupListQuery: createMockGroupListQuery(groups),
        reservationListQuery,
      },
      { actorUserId: "usr_1", now },
    );

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(findList).toHaveBeenCalledWith({
      groupIds: ["grp_1", "grp_2"],
      statuses: [ReservationStatus.Provisional, ReservationStatus.Approved],
      facilityId: null,
      from: now,
      to: null,
      sort: "start_at_asc",
      limit: UPCOMING_RESERVATIONS_LIMIT,
    });

    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toEqual({
      id: "res_1",
      groupName: "団体A",
      facilityId: "fac_1",
      facilityName: "会議室A",
      startAt: new Date("2026-10-16T10:00:00.000Z"),
      endAt: new Date("2026-10-16T12:00:00.000Z"),
      status: ReservationStatus.Approved,
      statusReason: null,
      headCount: 4,
      note: "ミーティング",
      createdByName: "ユーザー1",
      requestedAt: new Date("2026-10-10T10:00:00.000Z"),
      hasApprovedOverlap: false,
      hasProvisionalOverlap: false,
    });
  });

  it("所属団体取得の失敗エラーを伝播する", async () => {
    const error: QueryError = {
      code: QueryErrorCode.DatabaseError,
      message: "DB error",
    };
    const userGroupListQuery = fakeUserGroupListQuery({
      findByUserId: () => errAsync(error),
    });

    const result = await listUpcomingReservationsUseCase(
      {
        userGroupListQuery,
        reservationListQuery: fakeReservationListQuery(),
      },
      { actorUserId: "usr_1", now },
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error).toEqual(error);
  });

  it("予約一覧取得の失敗エラーを伝播する", async () => {
    const error: QueryError = {
      code: QueryErrorCode.DatabaseError,
      message: "DB error",
    };
    const reservationListQuery = fakeReservationListQuery({
      findList: () => errAsync(error),
    });

    const result = await listUpcomingReservationsUseCase(
      {
        userGroupListQuery: createMockGroupListQuery([
          {
            id: "grp_1",
            name: "団体A",
            status: GroupStatus.Enabled,
            role: MembershipRole.Admin,
            memberCount: 1,
          },
        ]),
        reservationListQuery,
      },
      { actorUserId: "usr_1", now },
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error).toEqual(error);
  });
});
