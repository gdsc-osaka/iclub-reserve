import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { FacilityErrorCode, type Facility, type FacilityRepository } from "~/domain/facility";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import type { ReservationMailAudience } from "~/domain/mail/reservation-mail";
import {
  MembershipErrorCode,
  MembershipRole,
  type Membership,
  type MembershipRepository,
} from "~/domain/membership";
import {
  ReservationErrorCode,
  ReservationField,
  ReservationStatus,
  type ApplyContentEditArgs,
  type Reservation,
  type ReservationOverlapArgs,
  type ReservationRepository,
} from "~/domain/reservation";
import { ReservationEditOutcome, type ReservationContent } from "~/domain/reservation/edit";
import { QueryErrorCode } from "~/query/error";
import type { ReservationMailRecipientsQuery } from "~/query/reservation/reservation-mail-recipients";
import { editReservationUseCase, type EditReservationArgs } from "./edit-reservation";

/** 判定の基準になる「いま」。1789866000000 ミリ秒で、通知の idempotencyKey に入る */
const now = new Date("2026-09-20T10:00:00+09:00");

const approvedReservation: Reservation = {
  id: "res_01",
  groupId: "grp_robotics",
  facilityId: "fac_room_a",
  startAt: new Date("2026-09-25T10:00:00+09:00"),
  endAt: new Date("2026-09-25T12:00:00+09:00"),
  headCount: 4,
  note: null,
  status: ReservationStatus.Approved,
  statusReason: null,
  createdBy: "usr_student_01",
  createdAt: new Date("2026-09-18T09:00:00+09:00"),
  updatedAt: new Date("2026-09-19T09:00:00+09:00"),
};

const provisionalReservation: Reservation = {
  ...approvedReservation,
  status: ReservationStatus.Provisional,
};

/** いまの予約の内容そのまま。テストごとに変えたい項目だけ上書きする */
const currentContent: ReservationContent = {
  facilityId: approvedReservation.facilityId,
  startAt: approvedReservation.startAt,
  endAt: approvedReservation.endAt,
  headCount: approvedReservation.headCount,
  note: approvedReservation.note,
};

/** 予約の団体（grp_robotics）でのメンバーとしての所属 */
const memberMembership: Membership = {
  groupId: "grp_robotics",
  userId: "usr_member_01",
  role: MembershipRole.Member,
};

const activeFacility: Facility = {
  id: "fac_room_b",
  name: "会議室 B",
  description: null,
  photoUrl: null,
  googleCalendarId: null,
  calendarUrl: null,
  isActive: true,
  createdAt: new Date("2026-04-01T00:00:00+09:00"),
  updatedAt: new Date("2026-04-01T00:00:00+09:00"),
};

const defaultAudience: ReservationMailAudience = {
  groupMembers: [{ userId: "usr_student_01", address: "student@example.com", name: "申請者" }],
  staff: [{ userId: "usr_staff_01", address: "staff@example.com", name: "事務局" }],
};

const argsWith = (
  content: Partial<ReservationContent>,
  overrides: Partial<EditReservationArgs> = {},
): EditReservationArgs => ({
  reservationId: approvedReservation.id,
  actorUserId: "usr_member_01",
  isStaff: false,
  now,
  content: { ...currentContent, ...content },
  ...overrides,
});

const createDeps = (
  overrides: {
    reservation?: Reservation | null;
    /** 予約の団体での所属。null は所属していないことを表す */
    membership?: Membership | null;
    membershipDbError?: boolean;
    facility?: Facility;
    facilityNotFound?: boolean;
    hasApprovedOverlap?: boolean;
    /** 条件付き更新が 1 件更新できたか。false は同時操作との競合を表す */
    applied?: boolean;
    recipientsDbError?: boolean;
  } = {},
) => {
  const reservation =
    overrides.reservation === undefined ? approvedReservation : overrides.reservation;
  const applied = overrides.applied ?? true;

  const findById = vi.fn((_id: string) =>
    reservation === null
      ? errAsync({ code: ReservationErrorCode.NotFound, message: "not found" })
      : okAsync(reservation),
  );
  const existsApprovedOverlap = vi.fn((_args: ReservationOverlapArgs) =>
    okAsync(overrides.hasApprovedOverlap ?? false),
  );
  const applyContentEdit = vi.fn((_args: ApplyContentEditArgs, _mails: readonly MailDraft[]) =>
    okAsync({ applied, enqueuedMailIds: applied ? ["outbox_01", "outbox_02"] : [] }),
  );

  const reservationRepository: ReservationRepository = {
    findById,
    existsApprovedOverlap,
    applyContentEdit,
    // このテストでは呼ばれない前提。呼ばれたら失敗して気付けるようにしてある
    create: () =>
      errAsync({ code: ReservationErrorCode.DatabaseError, message: "このテストでは使わない" }),
    createApproved: () =>
      errAsync({ code: ReservationErrorCode.DatabaseError, message: "このテストでは使わない" }),
    applyStatusTransition: () =>
      errAsync({ code: ReservationErrorCode.DatabaseError, message: "このテストでは使わない" }),
  };

  const findByGroupAndUser = vi.fn((_groupId: string, _userId: string) =>
    overrides.membershipDbError === true
      ? errAsync({ code: MembershipErrorCode.DatabaseError, message: "db down" })
      : okAsync(overrides.membership === undefined ? memberMembership : overrides.membership),
  );
  const membershipRepository: MembershipRepository = {
    findByGroupAndUser,
    countAdmins: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
    updateRole: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
    remove: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
  };

  const findFacility = vi.fn((_id: string) =>
    overrides.facilityNotFound === true
      ? errAsync({ code: FacilityErrorCode.NotFound, message: "not found" })
      : okAsync(overrides.facility ?? activeFacility),
  );
  const facilityRepository: FacilityRepository = {
    findById: findFacility,
    create: () =>
      errAsync({ code: FacilityErrorCode.DatabaseError, message: "このテストでは使わない" }),
    update: () =>
      errAsync({ code: FacilityErrorCode.DatabaseError, message: "このテストでは使わない" }),
    countBlockingReservations: () =>
      errAsync({ code: FacilityErrorCode.DatabaseError, message: "このテストでは使わない" }),
    updateActiveStatus: () =>
      errAsync({ code: FacilityErrorCode.DatabaseError, message: "このテストでは使わない" }),
  };

  const findByReservationId = vi.fn((_reservationId: string) =>
    overrides.recipientsDbError === true
      ? errAsync({ code: QueryErrorCode.DatabaseError, message: "db down" })
      : okAsync(defaultAudience),
  );
  const reservationMailRecipientsQuery: ReservationMailRecipientsQuery = {
    findByReservationId,
    findForNewReservation: () =>
      errAsync({ code: QueryErrorCode.DatabaseError, message: "このテストでは使わない" }),
    findForMessage: () =>
      errAsync({ code: QueryErrorCode.DatabaseError, message: "このテストでは使わない" }),
  };

  const notifyEnqueued = vi.fn((_outboxIds: readonly string[]) => {});

  return {
    deps: {
      reservationRepository,
      membershipRepository,
      facilityRepository,
      reservationMailRecipientsQuery,
      mailOutboxNotifier: { notifyEnqueued },
    },
    spies: {
      findById,
      existsApprovedOverlap,
      applyContentEdit,
      findByGroupAndUser,
      findFacility,
      findByReservationId,
      notifyEnqueued,
    },
  };
};

describe("editReservationUseCase", () => {
  describe("承認済みの予約（UC-005）", () => {
    it("使用人数・備考だけなら承認済みのまま変わり、重なりも施設も確かめずに EVT-004 を積む", async () => {
      const { deps, spies } = createDeps();

      const result = await editReservationUseCase(
        deps,
        argsWith({ headCount: 6, note: "機材を持ち込みます" }),
      );

      expect(result._unsafeUnwrap()).toEqual({
        reservationId: "res_01",
        outcome: ReservationEditOutcome.KeepApproved,
        status: ReservationStatus.Approved,
      });
      expect(spies.existsApprovedOverlap).not.toHaveBeenCalled();
      expect(spies.findFacility).not.toHaveBeenCalled();
      expect(spies.applyContentEdit).toHaveBeenCalledWith(
        {
          id: "res_01",
          expectedStatus: ReservationStatus.Approved,
          expectedUpdatedAt: approvedReservation.updatedAt,
          facilityId: "fac_room_a",
          startAt: approvedReservation.startAt,
          endAt: approvedReservation.endAt,
          headCount: 6,
          note: "機材を持ち込みます",
          status: ReservationStatus.Approved,
          updatedAt: now,
          requireNoApprovedOverlap: false,
        },
        [
          expect.objectContaining({
            idempotencyKey: "reservation:approvedEdited:res_01:1789866000000:usr_student_01",
            subject: "【i-Club予約システム】施設・設備の利用予約の内容が変更されました",
          }),
          // 団体の操作なので、事務局にも知らせる（EVT-004）
          expect.objectContaining({
            idempotencyKey: "reservation:approvedEdited:res_01:1789866000000:usr_staff_01",
          }),
        ],
      );
      expect(spies.notifyEnqueued).toHaveBeenCalledWith(["outbox_01", "outbox_02"]);
    });

    it("日時を変えると仮予約に戻り、変更後の時間帯で（自分を除いて）重なりを確かめる", async () => {
      const { deps, spies } = createDeps();
      const startAt = new Date("2026-09-25T11:00:00+09:00");
      const endAt = new Date("2026-09-25T13:00:00+09:00");

      const result = await editReservationUseCase(deps, argsWith({ startAt, endAt }));

      expect(result._unsafeUnwrap()).toEqual({
        reservationId: "res_01",
        outcome: ReservationEditOutcome.Reapproval,
        status: ReservationStatus.Provisional,
      });
      /*
       * 自分を除かないと、10:00〜12:00 を 11:00〜13:00 に動かすだけで、
       * 動かす前の自分（承認済み）と重なって必ず拒まれる。
       */
      expect(spies.existsApprovedOverlap).toHaveBeenCalledWith({
        facilityId: "fac_room_a",
        startAt,
        endAt,
        excludeReservationId: "res_01",
      });

      const [editArgs, mails] = spies.applyContentEdit.mock.calls[0] ?? [];
      expect(editArgs).toMatchObject({
        expectedStatus: ReservationStatus.Approved,
        status: ReservationStatus.Provisional,
        startAt,
        endAt,
        requireNoApprovedOverlap: true,
      });
      expect(mails?.[0]).toMatchObject({
        idempotencyKey: "reservation:reapprovalRequested:res_01:1789866000000:usr_student_01",
        subject: "【i-Club予約システム】施設・設備の利用予約が変更され、再承認待ちになりました",
      });
      // 通知には変更後の日時を載せる
      expect(mails?.[0]?.text).toContain("利用開始日時: 2026年9月25日 11:00");
    });

    it("施設を変えると、変更先の施設が使えるかを確かめてから仮予約に戻す", async () => {
      const { deps, spies } = createDeps();

      const result = await editReservationUseCase(deps, argsWith({ facilityId: "fac_room_b" }));

      expect(result._unsafeUnwrap().outcome).toBe(ReservationEditOutcome.Reapproval);
      expect(spies.findFacility).toHaveBeenCalledWith("fac_room_b");
      expect(spies.existsApprovedOverlap).toHaveBeenCalledWith(
        expect.objectContaining({ facilityId: "fac_room_b", excludeReservationId: "res_01" }),
      );
    });
  });

  describe("仮予約（UC-017）", () => {
    it("日時を変えても仮予約のまま変わり、重なりを確かめて EVT-012 を積む", async () => {
      const { deps, spies } = createDeps({ reservation: provisionalReservation });
      const startAt = new Date("2026-09-26T14:00:00+09:00");
      const endAt = new Date("2026-09-26T15:30:00+09:00");

      const result = await editReservationUseCase(deps, argsWith({ startAt, endAt }));

      expect(result._unsafeUnwrap()).toEqual({
        reservationId: "res_01",
        outcome: ReservationEditOutcome.KeepProvisional,
        status: ReservationStatus.Provisional,
      });
      expect(spies.existsApprovedOverlap).toHaveBeenCalledTimes(1);
      const [editArgs, mails] = spies.applyContentEdit.mock.calls[0] ?? [];
      expect(editArgs).toMatchObject({
        expectedStatus: ReservationStatus.Provisional,
        status: ReservationStatus.Provisional,
        requireNoApprovedOverlap: true,
      });
      expect(mails?.map((mail) => mail.idempotencyKey)).toEqual([
        "reservation:provisionalEdited:res_01:1789866000000:usr_student_01",
        "reservation:provisionalEdited:res_01:1789866000000:usr_staff_01",
      ]);
    });

    it("使用人数だけの変更では、承認済みの予約と重なっていても止めない", async () => {
      /*
       * 仮予約どうしは重なってよいので、重なっていた別の仮予約が先に承認されると、
       * この仮予約は承認済みの予約と重なったままになる。時間帯を変えていないのに
       * 重なりを確かめると、使用人数すら直せなくなる。
       */
      const { deps, spies } = createDeps({
        reservation: provisionalReservation,
        hasApprovedOverlap: true,
      });

      const result = await editReservationUseCase(deps, argsWith({ headCount: 2 }));

      expect(result._unsafeUnwrap().outcome).toBe(ReservationEditOutcome.KeepProvisional);
      expect(spies.existsApprovedOverlap).not.toHaveBeenCalled();
    });
  });

  describe("何も変えていないとき", () => {
    it("書き込みも通知もせず、いまのステータスを返す", async () => {
      const { deps, spies } = createDeps();

      // 同じ時刻の別の Date。=== で比べると、日時を変えたと誤って判定される
      const result = await editReservationUseCase(
        deps,
        argsWith({
          startAt: new Date(approvedReservation.startAt.getTime()),
          endAt: new Date(approvedReservation.endAt.getTime()),
        }),
      );

      expect(result._unsafeUnwrap()).toEqual({
        reservationId: "res_01",
        outcome: ReservationEditOutcome.NoChange,
        status: ReservationStatus.Approved,
      });
      expect(spies.applyContentEdit).not.toHaveBeenCalled();
      expect(spies.findByReservationId).not.toHaveBeenCalled();
      expect(spies.notifyEnqueued).not.toHaveBeenCalled();
    });
  });

  describe("誰が変えられるか", () => {
    it("所属していない人は変えられない", async () => {
      const { deps, spies } = createDeps({ membership: null });

      const result = await editReservationUseCase(deps, argsWith({ headCount: 6 }));

      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: ReservationErrorCode.Forbidden,
        userMessage: "所属している団体の予約のみ変更できます。",
      });
      expect(spies.applyContentEdit).not.toHaveBeenCalled();
    });

    it("所属していない事務局は変えられない（事務局の変更は UC-008 で扱う）", async () => {
      const { deps, spies } = createDeps({ membership: null });

      const result = await editReservationUseCase(
        deps,
        argsWith({ headCount: 6 }, { isStaff: true, actorUserId: "usr_staff_01" }),
      );

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Forbidden);
      // 事務局の役割には変更が無いので、事務局でも所属を引きに行く
      expect(spies.findByGroupAndUser).toHaveBeenCalledWith("grp_robotics", "usr_staff_01");
    });

    it("事務局の人でも、所属する団体の予約ならメンバーとして変えられる", async () => {
      const { deps } = createDeps();

      const result = await editReservationUseCase(
        deps,
        argsWith({ headCount: 6 }, { isStaff: true }),
      );

      expect(result.isOk()).toBe(true);
    });

    it("権限が無い人には、入力の誤りより先に権限が無いことを返す", async () => {
      const { deps } = createDeps({ membership: null });

      const result = await editReservationUseCase(deps, argsWith({ headCount: 0 }));

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Forbidden);
    });
  });

  describe("変えられない予約", () => {
    it("終了した予約は変えられない", async () => {
      const { deps, spies } = createDeps({
        reservation: { ...approvedReservation, status: ReservationStatus.Cancelled },
      });

      const result = await editReservationUseCase(deps, argsWith({ headCount: 6 }));

      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: ReservationErrorCode.InvalidTransition,
        userMessage: "終了した予約は変更できません。",
      });
      expect(spies.applyContentEdit).not.toHaveBeenCalled();
    });

    it("開始日時を過ぎた予約は、備考だけでも変えられない", async () => {
      const { deps } = createDeps({
        reservation: {
          ...approvedReservation,
          startAt: new Date("2026-09-20T09:00:00+09:00"),
          endAt: new Date("2026-09-20T11:00:00+09:00"),
        },
      });

      const result = await editReservationUseCase(deps, argsWith({ note: "後から追記" }));

      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: ReservationErrorCode.InvalidTransition,
        userMessage: "開始日時を過ぎた予約は変更できません。",
      });
    });

    it("予約が無ければ、そのまま NotFound を返す", async () => {
      const { deps } = createDeps({ reservation: null });

      const result = await editReservationUseCase(deps, argsWith({ headCount: 6 }));

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.NotFound);
    });
  });

  describe("入力の規則（COND-021。申請と同じ）", () => {
    it.each([
      [
        "過ぎた日時へ動かす",
        {
          startAt: new Date("2026-09-19T10:00:00+09:00"),
          endAt: new Date("2026-09-19T12:00:00+09:00"),
        },
        ReservationErrorCode.InvalidPeriod,
        ReservationField.Period,
      ],
      [
        "30 分刻みに揃っていない",
        { endAt: new Date("2026-09-25T12:15:00+09:00") },
        ReservationErrorCode.InvalidPeriod,
        ReservationField.Period,
      ],
      [
        "利用できる時間帯の外にかかる",
        { endAt: new Date("2026-09-25T21:30:00+09:00") },
        ReservationErrorCode.InvalidPeriod,
        ReservationField.Period,
      ],
      [
        "使用人数が 0",
        { headCount: 0 },
        ReservationErrorCode.InvalidInput,
        ReservationField.HeadCount,
      ],
      [
        "備考が 501 文字",
        { note: "あ".repeat(501) },
        ReservationErrorCode.InvalidInput,
        ReservationField.Note,
      ],
    ] as const)("%s変更は拒む", async (_name, content, code, field) => {
      const { deps, spies } = createDeps();

      const result = await editReservationUseCase(deps, argsWith(content));

      expect(result._unsafeUnwrapErr()).toMatchObject({ code, field });
      expect(spies.applyContentEdit).not.toHaveBeenCalled();
    });
  });

  describe("施設と重なり", () => {
    it("変更先の施設が無効なら拒む", async () => {
      const { deps, spies } = createDeps({ facility: { ...activeFacility, isActive: false } });

      const result = await editReservationUseCase(deps, argsWith({ facilityId: "fac_room_b" }));

      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: ReservationErrorCode.FacilityNotAvailable,
        field: ReservationField.Facility,
      });
      expect(spies.applyContentEdit).not.toHaveBeenCalled();
    });

    it("変更先の施設が見つからなければ拒む", async () => {
      const { deps } = createDeps({ facilityNotFound: true });

      const result = await editReservationUseCase(deps, argsWith({ facilityId: "fac_missing" }));

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.FacilityNotAvailable);
    });

    it("変更後の時間帯に承認済みの予約があれば、時間帯の欄に出す誤りで拒む", async () => {
      const { deps, spies } = createDeps({ hasApprovedOverlap: true });

      const result = await editReservationUseCase(
        deps,
        argsWith({ endAt: new Date("2026-09-25T13:00:00+09:00") }),
      );

      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: ReservationErrorCode.Conflict,
        field: ReservationField.Period,
        userMessage:
          "選んだ時間帯には、すでに承認済みの予約が入っています。別の時間帯を選んでください。",
      });
      expect(spies.applyContentEdit).not.toHaveBeenCalled();
    });
  });

  describe("書き込み", () => {
    it("読んだ後に予約が変わっていて更新できなければ Conflict を返し、配送を依頼しない", async () => {
      const { deps, spies } = createDeps({ applied: false });

      const result = await editReservationUseCase(deps, argsWith({ headCount: 6 }));

      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: ReservationErrorCode.Conflict,
        userMessage:
          "この予約には別の操作が先に反映されました。画面を読み込み直して、内容を確認してください。",
      });
      expect(spies.notifyEnqueued).not.toHaveBeenCalled();
    });

    it("通知先を読めなければ、書き込まずに失敗する", async () => {
      const { deps, spies } = createDeps({ recipientsDbError: true });

      const result = await editReservationUseCase(deps, argsWith({ headCount: 6 }));

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.DatabaseError);
      expect(spies.applyContentEdit).not.toHaveBeenCalled();
    });

    it("所属を読めなければ、DatabaseError を返す", async () => {
      const { deps } = createDeps({ membershipDbError: true });

      const result = await editReservationUseCase(deps, argsWith({ headCount: 6 }));

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.DatabaseError);
    });
  });
});
