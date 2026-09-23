import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import {
  ReservationErrorCode,
  ReservationStatus,
  type Reservation,
  type ReservationRepository,
} from "~/domain/reservation";
import { QueryErrorCode } from "~/query/error";
import type {
  ReservationFormArgs,
  ReservationFormQuery,
  ReservationFormReservationRow,
} from "~/query/reservation/reservation-form";
import type { UserGroupList, UserGroupListQuery } from "~/query/user/user-group-list";
import { getReservationFormUseCase } from "./get-reservation-form";

const meetingRoomA = { id: "fac_meeting_a", name: "ミーティングルーム A", description: null };

/** 自分が所属している団体の予約 */
const ownRow: ReservationFormReservationRow = {
  id: "res_own",
  facilityId: "fac_meeting_a",
  groupId: "grp_robotics",
  groupName: "ロボティクス開発プロジェクト",
  startAt: new Date("2026-09-16T10:00:00+09:00"),
  endAt: new Date("2026-09-16T12:00:00+09:00"),
  status: ReservationStatus.Approved,
};

/** 所属していない団体の予約 */
const otherRow: ReservationFormReservationRow = {
  id: "res_other",
  facilityId: "fac_meeting_a",
  groupId: "grp_ai_hackers",
  groupName: "AI ハッカソンチーム",
  startAt: new Date("2026-09-16T13:00:00+09:00"),
  endAt: new Date("2026-09-16T15:00:00+09:00"),
  status: ReservationStatus.Provisional,
};

const myGroups: UserGroupList = [
  {
    id: "grp_robotics",
    name: "ロボティクス開発プロジェクト",
    status: GroupStatus.Enabled,
    role: MembershipRole.Member,
    memberCount: 4,
  },
];

const createdReservation: Reservation = {
  id: "res_created",
  facilityId: "fac_meeting_a",
  groupId: "grp_robotics",
  startAt: new Date("2026-09-16T16:00:00+09:00"),
  endAt: new Date("2026-09-16T17:00:00+09:00"),
  headCount: 4,
  note: "キックオフ",
  status: ReservationStatus.Provisional,
  statusReason: null,
  createdBy: "usr_student_01",
  createdAt: new Date("2026-09-14T09:00:00+09:00"),
  updatedAt: new Date("2026-09-14T09:00:00+09:00"),
};

const createDeps = (
  overrides: {
    groups?: UserGroupList;
    created?: Reservation | null;
    /** `created` が無いときに `findById` が返す失敗。省略時は「見つからない」 */
    createdError?: ReservationErrorCode;
  } = {},
) => {
  const calls: ReservationFormArgs[] = [];

  const reservationFormQuery: ReservationFormQuery = {
    find: (args) => {
      calls.push(args);

      return okAsync({
        groups: [{ id: "grp_robotics", name: "ロボティクス開発プロジェクト" }],
        facilities: [meetingRoomA],
        reservations: [ownRow, otherRow],
      });
    },
  };

  const userGroupListQuery: UserGroupListQuery = {
    findByUserId: () => okAsync(overrides.groups ?? myGroups),
  };

  const reservationRepository: ReservationRepository = {
    findById: () =>
      overrides.created == null
        ? errAsync({
            code: overrides.createdError ?? ReservationErrorCode.NotFound,
            message: "予約を読めませんでした",
          })
        : okAsync(overrides.created),
    create: () => okAsync({ enqueuedMailIds: [] }),
    existsApprovedOverlap: () => okAsync(false),
    applyStatusTransition: () => okAsync({ applied: true, enqueuedMailIds: [] }),
  };

  return { deps: { reservationFormQuery, userGroupListQuery, reservationRepository }, calls };
};

const args = {
  actorUserId: "usr_student_01",
  isStaff: false,
  from: new Date("2026-09-14T00:00:00+09:00"),
  to: new Date("2026-09-21T00:00:00+09:00"),
  createdReservationId: null,
};

describe("getReservationFormUseCase", () => {
  it("予約に団体の ID を載せない", async () => {
    const { deps } = createDeps();

    const result = await getReservationFormUseCase(deps, args);

    // COND-008: 画面は団体名しか出さないので、ID は渡さない
    expect(JSON.stringify(result._unsafeUnwrap().reservations)).not.toContain("grp_ai_hackers");
    expect(JSON.stringify(result._unsafeUnwrap().reservations)).not.toContain("grp_robotics");
  });

  it("自団体の予約かどうかを付けて返す", async () => {
    const { deps } = createDeps();

    const reservations = (await getReservationFormUseCase(deps, args))._unsafeUnwrap().reservations;

    expect(reservations.find((item) => item.id === "res_own")?.isOwnGroup).toBe(true);
    expect(reservations.find((item) => item.id === "res_other")?.isOwnGroup).toBe(false);
  });

  it("一般のユーザーは、自分が所属している団体だけを申請元にできる", async () => {
    const { deps, calls } = createDeps();

    await getReservationFormUseCase(deps, args);

    // COND-006: 所属で絞り込む
    expect(calls[0]?.memberUserId).toBe("usr_student_01");
  });

  it("事務局は所属で絞り込まない", async () => {
    const { deps, calls } = createDeps({ groups: [] });

    await getReservationFormUseCase(deps, { ...args, isStaff: true });

    // COND-009: 所属に関わらず任意の団体として申請できる
    expect(calls[0]?.memberUserId).toBeNull();
  });

  it("所属していない事務局から見れば、どの予約も自団体ではない", async () => {
    const { deps } = createDeps({ groups: [] });

    const result = await getReservationFormUseCase(deps, { ...args, isStaff: true });

    expect(result._unsafeUnwrap().reservations.every((item) => !item.isOwnGroup)).toBe(true);
  });

  it("申請し終えた直後は、いま作った予約の控えを返す", async () => {
    const { deps } = createDeps({ created: createdReservation });

    const result = await getReservationFormUseCase(deps, {
      ...args,
      createdReservationId: "res_created",
    });

    expect(result._unsafeUnwrap().created).toMatchObject({
      id: "res_created",
      groupName: "ロボティクス開発プロジェクト",
      facilityName: "ミーティングルーム A",
      headCount: 4,
      note: "キックオフ",
    });
  });

  it("自分が作っていない予約の控えは返さない", async () => {
    // COND-008: URL を書き換えて他人の使用人数・備考を読み取れないようにする
    const { deps } = createDeps({
      created: { ...createdReservation, createdBy: "usr_someone_else" },
    });

    const result = await getReservationFormUseCase(deps, {
      ...args,
      createdReservationId: "res_created",
    });

    expect(result._unsafeUnwrap().created).toBeNull();
  });

  it("控えが見つからなくてもフォームはエラーにしない", async () => {
    // ID は利用者が書き換えられるので、無い ID を渡されただけで画面を潰さない
    const { deps } = createDeps({ created: null });

    const result = await getReservationFormUseCase(deps, {
      ...args,
      createdReservationId: "res_missing",
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().created).toBeNull();
  });

  it("控えの読み取りに失敗したら、控え無しで済ませずに失敗を返す", async () => {
    /*
     * ここで握りつぶすと、申請が済んでいるのに空のフォームが出てしまう。
     * 申請できなかったと思った人がもう一度送ると、仮予約が二重に作られる。
     */
    const { deps } = createDeps({
      created: null,
      createdError: ReservationErrorCode.DatabaseError,
    });

    const result = await getReservationFormUseCase(deps, {
      ...args,
      createdReservationId: "res_created",
    });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.DatabaseError);
  });
});
