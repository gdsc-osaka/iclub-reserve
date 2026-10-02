import { describe, expect, it } from "vitest";

import { MembershipRole, type Actor } from "../membership";
import { ReservationErrorCode, ReservationStatus } from ".";
import {
  canEditReservation,
  changedContentFields,
  editTargetStatus,
  requiresOverlapCheck,
  resolveEditOutcome,
  ReservationEditOutcome,
  type ReservationContent,
  type ReservationContentField,
} from "./edit";

const membershipOf = (role: MembershipRole) => ({ groupId: "grp_01", userId: "usr_01", role });

const actors = {
  所属なし: { isStaff: false, membership: null },
  メンバー: { isStaff: false, membership: membershipOf(MembershipRole.Member) },
  管理者: { isStaff: false, membership: membershipOf(MembershipRole.Admin) },
  事務局: { isStaff: true, membership: null },
  事務局かつメンバー: { isStaff: true, membership: membershipOf(MembershipRole.Member) },
} as const satisfies Record<string, Actor>;

/** 判定の基準になる「いま」 */
const now = new Date("2026-09-20T10:00:00+09:00");

/** 開始前の仮予約 */
const upcoming = {
  status: ReservationStatus.Provisional,
  startAt: new Date("2026-09-25T10:00:00+09:00"),
};

describe("canEditReservation", () => {
  describe("誰が変えられるか（COND-009）", () => {
    it.each([
      ["メンバー", actors.メンバー],
      ["管理者", actors.管理者],
      // 事務局の人でも、所属する団体の予約ならメンバーとして変えられる
      ["事務局かつメンバー", actors.事務局かつメンバー],
    ])("%s は変えられる", (_name, actor) => {
      expect(canEditReservation(upcoming, actor, now).isOk()).toBe(true);
    });

    it.each([
      ["所属なし", actors.所属なし],
      /*
       * 事務局の変更は承認フローを経ない直接変更（UC-008）で、規則が違う。
       * ここを通すと、事務局の変更が団体の変更（UC-005）の規則で通ってしまう。
       */
      ["事務局（所属なし）", actors.事務局],
    ])("%s は変えられない", (_name, actor) => {
      const error = canEditReservation(upcoming, actor, now)._unsafeUnwrapErr();

      expect(error.code).toBe(ReservationErrorCode.Forbidden);
      expect(error.userMessage).toBe("所属している団体の予約のみ変更できます。");
    });

    it("権限が無いことを、状態や開始日時より先に答える", () => {
      // 終わった予約でも、所属していない人には「権限が無い」と答える
      const error = canEditReservation(
        { status: ReservationStatus.Withdrawn, startAt: new Date("2026-09-01T10:00:00+09:00") },
        actors.所属なし,
        now,
      )._unsafeUnwrapErr();

      expect(error.code).toBe(ReservationErrorCode.Forbidden);
    });
  });

  describe("いまの状態（STATE-001）", () => {
    it.each([ReservationStatus.Provisional, ReservationStatus.Approved])(
      "%s の予約は変えられる",
      (status) => {
        expect(canEditReservation({ ...upcoming, status }, actors.メンバー, now).isOk()).toBe(true);
      },
    );

    it.each([
      ReservationStatus.Withdrawn,
      ReservationStatus.Rejected,
      ReservationStatus.Cancelled,
      ReservationStatus.CancelledByStaff,
    ])("終了した予約（%s）は変えられない", (status) => {
      const error = canEditReservation(
        { ...upcoming, status },
        actors.メンバー,
        now,
      )._unsafeUnwrapErr();

      expect(error.code).toBe(ReservationErrorCode.InvalidTransition);
      expect(error.userMessage).toBe("終了した予約は変更できません。");
    });
  });

  describe("開始日時", () => {
    it("開始日時を過ぎた予約は、承認済みでも変えられない", () => {
      const error = canEditReservation(
        { status: ReservationStatus.Approved, startAt: new Date("2026-09-20T09:00:00+09:00") },
        actors.メンバー,
        now,
      )._unsafeUnwrapErr();

      expect(error.code).toBe(ReservationErrorCode.InvalidTransition);
      expect(error.userMessage).toBe("開始日時を過ぎた予約は変更できません。");
    });

    it("ちょうど開始日時になった予約も変えられない", () => {
      const result = canEditReservation(
        { status: ReservationStatus.Approved, startAt: now },
        actors.メンバー,
        now,
      );

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.InvalidTransition);
    });

    it("開始の 1 ミリ秒前までは変えられる", () => {
      const result = canEditReservation(
        { status: ReservationStatus.Approved, startAt: new Date(now.getTime() + 1) },
        actors.メンバー,
        now,
      );

      expect(result.isOk()).toBe(true);
    });
  });
});

const before: ReservationContent = {
  facilityId: "fac_room_a",
  startAt: new Date("2026-09-25T10:00:00+09:00"),
  endAt: new Date("2026-09-25T12:00:00+09:00"),
  headCount: 4,
  note: null,
};

describe("changedContentFields", () => {
  it("同じ時刻の別の Date を渡しても、日時の変更と見なさない", () => {
    /*
     * Date を === で比べると、同じ時刻でも別物になる。
     * 取り違えると、備考だけ直した保存で承認済みの予約が仮予約に戻ってしまう。
     */
    const after: ReservationContent = {
      ...before,
      startAt: new Date(before.startAt.getTime()),
      endAt: new Date(before.endAt.getTime()),
    };

    expect([...changedContentFields(before, after)]).toEqual([]);
  });

  it("変えた項目だけを返す", () => {
    const after: ReservationContent = {
      ...before,
      endAt: new Date("2026-09-25T13:00:00+09:00"),
      note: "機材を持ち込みます",
    };

    expect(new Set(changedContentFields(before, after))).toEqual(new Set(["endAt", "note"]));
  });

  it("備考を消した（null にした）ことも変更として扱う", () => {
    const withNote: ReservationContent = { ...before, note: "週次定例" };

    expect([...changedContentFields(withNote, before)]).toEqual(["note"]);
  });
});

describe("resolveEditOutcome（COND-005）", () => {
  const cases: readonly [
    string,
    ReservationStatus,
    readonly ReservationContentField[],
    ReservationEditOutcome,
  ][] = [
    ["何も変えていない仮予約", ReservationStatus.Provisional, [], ReservationEditOutcome.NoChange],
    ["何も変えていない承認済み", ReservationStatus.Approved, [], ReservationEditOutcome.NoChange],
    [
      "仮予約の施設・日時を変えても",
      ReservationStatus.Provisional,
      ["facilityId", "startAt", "endAt"],
      ReservationEditOutcome.KeepProvisional,
    ],
    [
      "仮予約の使用人数・備考を変えても",
      ReservationStatus.Provisional,
      ["headCount", "note"],
      ReservationEditOutcome.KeepProvisional,
    ],
    [
      "承認済みの使用人数を変えると",
      ReservationStatus.Approved,
      ["headCount"],
      ReservationEditOutcome.KeepApproved,
    ],
    [
      "承認済みの備考を変えると",
      ReservationStatus.Approved,
      ["note"],
      ReservationEditOutcome.KeepApproved,
    ],
    [
      "承認済みの施設を変えると",
      ReservationStatus.Approved,
      ["facilityId"],
      ReservationEditOutcome.Reapproval,
    ],
    [
      "承認済みの開始時刻を変えると",
      ReservationStatus.Approved,
      ["startAt"],
      ReservationEditOutcome.Reapproval,
    ],
    [
      "承認済みの終了時刻を変えると",
      ReservationStatus.Approved,
      ["endAt"],
      ReservationEditOutcome.Reapproval,
    ],
    [
      "承認済みの使用人数と日時を一緒に変えると",
      ReservationStatus.Approved,
      ["headCount", "startAt"],
      ReservationEditOutcome.Reapproval,
    ],
  ];

  it.each(cases)("%s → %s / %j → %s", (_name, status, fields, expected) => {
    expect(resolveEditOutcome(status, new Set(fields))).toBe(expected);
  });

  it("仮予約に戻るときと仮予約のまま変えるときは仮予約、使用人数・備考だけなら承認済みのまま", () => {
    expect(editTargetStatus).toEqual({
      [ReservationEditOutcome.KeepProvisional]: ReservationStatus.Provisional,
      [ReservationEditOutcome.KeepApproved]: ReservationStatus.Approved,
      [ReservationEditOutcome.Reapproval]: ReservationStatus.Provisional,
    });
  });
});

describe("requiresOverlapCheck（COND-001）", () => {
  it.each([["facilityId"], ["startAt"], ["endAt"]] as const)(
    "%s を変えたら、承認済みの予約との重なりを確かめる",
    (field) => {
      expect(requiresOverlapCheck(new Set([field]))).toBe(true);
    },
  );

  it("使用人数・備考だけなら確かめない（変えていない時間帯を確かめ直さない）", () => {
    expect(requiresOverlapCheck(new Set(["headCount", "note"] as const))).toBe(false);
  });
});
