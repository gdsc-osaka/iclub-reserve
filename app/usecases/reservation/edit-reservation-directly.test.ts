import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { AuditLogAction } from "~/domain/audit-log";
import { FacilityErrorCode, type Facility, type FacilityRepository } from "~/domain/facility";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import { ReservationMailEvent, type ReservationMailAudience } from "~/domain/mail/reservation-mail";
import {
  MembershipErrorCode,
  MembershipRole,
  type StoredMembership,
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
import { APPROVED_OVERLAP_MESSAGE } from "./_shared/approved-overlap";
import {
  editReservationDirectlyUseCase,
  type EditReservationDirectlyArgs,
} from "./edit-reservation-directly";

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

const currentContent: ReservationContent = {
  facilityId: approvedReservation.facilityId,
  startAt: approvedReservation.startAt,
  endAt: approvedReservation.endAt,
  headCount: approvedReservation.headCount,
  note: approvedReservation.note,
};

const memberMembership: StoredMembership = {
  id: "gm_memberMembership",
  groupId: "grp_robotics",
  userId: "usr_staff_01",
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
  overrides: Partial<EditReservationDirectlyArgs> = {},
): EditReservationDirectlyArgs => ({
  reservationId: approvedReservation.id,
  actorUserId: "usr_staff_01",
  isStaff: true,
  now,
  content: { ...currentContent, ...content },
  ...overrides,
});

const createDeps = (
  overrides: {
    reservation?: Reservation | null;
    membership?: StoredMembership | null;
    membershipDbError?: boolean;
    facility?: Facility;
    facilityNotFound?: boolean;
    hasApprovedOverlap?: boolean;
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
  const applyContentEdit = vi.fn(
    (
      _args: ApplyContentEditArgs,
      _mails: readonly MailDraft[],
      _auditLog?: unknown,
      _calendarSync?: unknown,
    ) => okAsync({ applied, enqueuedMailIds: applied ? ["outbox_01"] : [] }),
  );

  const reservationRepository: ReservationRepository = {
    findById,
    existsApprovedOverlap,
    applyContentEdit,
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
      ? errAsync({ code: QueryErrorCode.DatabaseError, message: "query error" })
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
  const mailOutboxNotifier = { notifyEnqueued };

  return {
    deps: {
      reservationRepository,
      membershipRepository,
      facilityRepository,
      reservationMailRecipientsQuery,
      mailOutboxNotifier,
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

describe("editReservationDirectlyUseCase", () => {
  describe("権限の確認（COND-009）", () => {
    it("事務局でない人（自団体のメンバー・他団体のメンバー）は Forbidden で拒否される", async () => {
      const { deps } = createDeps();

      const result = await editReservationDirectlyUseCase(
        deps,
        argsWith({ headCount: 5 }, { isStaff: false }),
      );

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(ReservationErrorCode.Forbidden);
      expect(error.userMessage).toBe("予約を直接変更できるのは事務局だけです。");
    });

    it("事務局なら、団体に所属していなくても所属テーブルを引かずに通る", async () => {
      const { deps, spies } = createDeps({ membership: null });

      const result = await editReservationDirectlyUseCase(deps, argsWith({ headCount: 5 }));

      expect(result.isOk()).toBe(true);
      // 所属を引かずに済む最適化
      expect(spies.findByGroupAndUser).not.toHaveBeenCalled();
    });

    it("事務局が予約の団体のメンバーでも、団体の変更ではなく直接変更として通る", async () => {
      const { deps, spies } = createDeps({ membership: memberMembership });

      const result = await editReservationDirectlyUseCase(
        deps,
        argsWith({
          startAt: new Date("2026-09-25T13:00:00+09:00"),
          endAt: new Date("2026-09-25T15:00:00+09:00"),
        }),
      );

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      // 承認済みのまま！
      expect(value.status).toBe(ReservationStatus.Approved);
      expect(value.outcome).toBe(ReservationEditOutcome.KeepApproved);
      expect(spies.findByGroupAndUser).not.toHaveBeenCalled();
    });
  });

  describe("予約の状態と開始時刻の確認（STATE-001）", () => {
    it.each([
      ReservationStatus.Withdrawn,
      ReservationStatus.Rejected,
      ReservationStatus.Cancelled,
      ReservationStatus.CancelledByStaff,
    ])("終了した予約（%s）は InvalidTransition で拒否される", async (status) => {
      const { deps } = createDeps({
        reservation: { ...approvedReservation, status },
      });

      const result = await editReservationDirectlyUseCase(deps, argsWith({ headCount: 5 }));

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(ReservationErrorCode.InvalidTransition);
      expect(error.userMessage).toBe("終了した予約は変更できません。");
    });

    it("開始日時を過ぎた予約は InvalidTransition で拒否される", async () => {
      const { deps } = createDeps({
        reservation: {
          ...approvedReservation,
          startAt: new Date("2026-09-20T09:00:00+09:00"),
        },
      });

      const result = await editReservationDirectlyUseCase(deps, argsWith({ headCount: 5 }));

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(ReservationErrorCode.InvalidTransition);
      expect(error.userMessage).toBe("開始日時を過ぎた予約は変更できません。");
    });
  });

  describe("入力の検証（COND-021）", () => {
    it("開始時刻が30分単位でない場合は検証エラーになる", async () => {
      const { deps } = createDeps();

      const result = await editReservationDirectlyUseCase(
        deps,
        argsWith({ startAt: new Date("2026-09-25T10:15:00+09:00") }),
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.InvalidPeriod);
    });

    it("過去の日時を指定した場合は検証エラーになる", async () => {
      const { deps } = createDeps();

      const result = await editReservationDirectlyUseCase(
        deps,
        argsWith({
          startAt: new Date("2026-09-19T10:00:00+09:00"),
          endAt: new Date("2026-09-19T12:00:00+09:00"),
        }),
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.InvalidPeriod);
    });

    it("使用人数が0名以下の場合は検証エラーになる", async () => {
      const { deps } = createDeps();

      const result = await editReservationDirectlyUseCase(deps, argsWith({ headCount: 0 }));

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.InvalidInput);
    });
  });

  describe("変更の適用と結果", () => {
    it("何も変えていなければ NoChange で返し、DB書き込みもメールも行わない", async () => {
      const { deps, spies } = createDeps();

      const result = await editReservationDirectlyUseCase(deps, argsWith({}));

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.outcome).toBe(ReservationEditOutcome.NoChange);
      expect(value.status).toBe(ReservationStatus.Approved);

      expect(spies.applyContentEdit).not.toHaveBeenCalled();
      expect(spies.notifyEnqueued).not.toHaveBeenCalled();
    });

    it("承認済みの施設・日時を変えると承認済みのまま、重なりを確かめて更新する", async () => {
      const { deps, spies } = createDeps();

      const newStartAt = new Date("2026-09-25T13:00:00+09:00");
      const newEndAt = new Date("2026-09-25T15:00:00+09:00");
      const result = await editReservationDirectlyUseCase(
        deps,
        argsWith({ startAt: newStartAt, endAt: newEndAt }),
      );

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.outcome).toBe(ReservationEditOutcome.KeepApproved);
      expect(value.status).toBe(ReservationStatus.Approved);

      // 重なり確認が自分自身を除いて呼ばれたこと
      expect(spies.existsApprovedOverlap).toHaveBeenCalledWith({
        facilityId: approvedReservation.facilityId,
        startAt: newStartAt,
        endAt: newEndAt,
        excludeReservationId: approvedReservation.id,
      });

      // applyContentEdit に渡された引数
      expect(spies.applyContentEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          id: approvedReservation.id,
          status: ReservationStatus.Approved,
          startAt: newStartAt,
          endAt: newEndAt,
          requireNoApprovedOverlap: true,
        }),
        expect.any(Array),
        expect.objectContaining({
          action: AuditLogAction.ReservationDirectChange,
          actedAsStaff: true,
        }),
        {
          reservationId: approvedReservation.id,
          previousFacilityId: null,
        },
      );

      // 即時配送が呼ばれたこと
      expect(spies.notifyEnqueued).toHaveBeenCalledWith(["outbox_01"]);
    });

    it("承認済みの使用人数・備考だけを変更する場合は重なりを確かめない", async () => {
      const { deps, spies } = createDeps();

      const result = await editReservationDirectlyUseCase(
        deps,
        argsWith({ headCount: 8, note: "新備考" }),
      );

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.outcome).toBe(ReservationEditOutcome.KeepApproved);
      expect(value.status).toBe(ReservationStatus.Approved);

      expect(spies.existsApprovedOverlap).not.toHaveBeenCalled();
      expect(spies.applyContentEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          requireNoApprovedOverlap: false,
          headCount: 8,
          note: "新備考",
        }),
        expect.any(Array),
        expect.objectContaining({
          action: AuditLogAction.ReservationDirectChange,
          actedAsStaff: true,
        }),
        null,
      );
    });

    it("仮予約の施設・日時を変更しても仮予約のままで更新される", async () => {
      const { deps, spies } = createDeps({ reservation: provisionalReservation });

      const newStartAt = new Date("2026-09-25T14:00:00+09:00");
      const newEndAt = new Date("2026-09-25T16:00:00+09:00");
      const result = await editReservationDirectlyUseCase(
        deps,
        argsWith({ startAt: newStartAt, endAt: newEndAt }),
      );

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.outcome).toBe(ReservationEditOutcome.KeepProvisional);
      expect(value.status).toBe(ReservationStatus.Provisional);

      expect(spies.applyContentEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ReservationStatus.Provisional,
        }),
        expect.any(Array),
        expect.objectContaining({
          action: AuditLogAction.ReservationDirectChange,
          actedAsStaff: true,
        }),
        null,
      );
    });

    it("施設を変更した場合は、変更先施設の有効性を確かめる", async () => {
      const { deps, spies } = createDeps();

      const result = await editReservationDirectlyUseCase(
        deps,
        argsWith({ facilityId: "fac_room_b" }),
      );

      expect(result.isOk()).toBe(true);
      expect(spies.findFacility).toHaveBeenCalledWith("fac_room_b");
    });

    it("変更先施設が無効（または存在しない）なら FacilityNotAvailable で失敗する", async () => {
      const { deps } = createDeps({
        facility: { ...activeFacility, isActive: false },
      });

      const result = await editReservationDirectlyUseCase(
        deps,
        argsWith({ facilityId: "fac_room_b" }),
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.FacilityNotAvailable);
    });

    it("承認済みの予約と重なる時間帯へ動かそうとすると、事務局用の文言で止まる", async () => {
      const { deps } = createDeps({ hasApprovedOverlap: true });

      const result = await editReservationDirectlyUseCase(
        deps,
        argsWith({
          startAt: new Date("2026-09-25T14:00:00+09:00"),
          endAt: new Date("2026-09-25T16:00:00+09:00"),
        }),
      );

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(ReservationErrorCode.Conflict);
      expect(error.field).toBe(ReservationField.Period);
      expect(error.userMessage).toBe(APPROVED_OVERLAP_MESSAGE);
    });

    /*
     * 0 件更新の原因は、時間帯が埋まったことだけでなく、読んだ後に別の人が変更・承認したことも
     * あり得る。どちらか見分けられないので、重なりの文言ではなく読み込み直しを促す文言にする。
     */
    it("applyContentEdit が applied: false だった場合は、読み込み直しを促す Conflict を返す", async () => {
      const { deps } = createDeps({ applied: false });

      const result = await editReservationDirectlyUseCase(
        deps,
        argsWith({
          startAt: new Date("2026-09-25T14:00:00+09:00"),
          endAt: new Date("2026-09-25T16:00:00+09:00"),
        }),
      );

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(ReservationErrorCode.Conflict);
      expect(error.field).toBeUndefined();
      expect(error.userMessage).toBe(
        "この予約には別の操作が先に反映されました。画面を読み込み直して、内容を確認してください。",
      );
    });

    it("メールは EVT-017 で積まれ、事務局には送信されない", async () => {
      const { deps, spies } = createDeps();

      await editReservationDirectlyUseCase(
        deps,
        argsWith({
          startAt: new Date("2026-09-25T14:00:00+09:00"),
          endAt: new Date("2026-09-25T16:00:00+09:00"),
        }),
      );

      expect(spies.applyContentEdit).toHaveBeenCalled();
      const [, mails] = spies.applyContentEdit.mock.calls[0]!;
      expect(mails).toHaveLength(1);
      expect(mails[0]?.to.address).toBe("student@example.com");
      expect(mails[0]?.idempotencyKey).toContain(
        `reservation:${ReservationMailEvent.EditedByStaff}:`,
      );
      expect(mails[0]?.subject).toBe(
        "【i-Club予約システム】施設・設備の利用予約が事務局により変更されました",
      );
    });
  });

  describe("カレンダー同期タスク草稿の作成（toCalendarSyncDraft）", () => {
    it("事務局の直接変更で日時だけ変えたときは同期タスクを積む（previousFacilityId なし）", async () => {
      const { deps, spies } = createDeps();

      await editReservationDirectlyUseCase(
        deps,
        argsWith({
          startAt: new Date("2026-09-25T14:00:00+09:00"),
          endAt: new Date("2026-09-25T16:00:00+09:00"),
        }),
      );

      expect(spies.applyContentEdit).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        {
          reservationId: approvedReservation.id,
          previousFacilityId: null,
        },
      );
    });

    it("事務局の直接変更で施設を変えたときは previousFacilityId ありで同期タスクを積む", async () => {
      const { deps, spies } = createDeps();

      await editReservationDirectlyUseCase(
        deps,
        argsWith({
          facilityId: "fac_room_b",
        }),
      );

      expect(spies.applyContentEdit).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        {
          reservationId: approvedReservation.id,
          previousFacilityId: "fac_room_a",
        },
      );
    });

    it("事務局の直接変更で使用人数・備考だけを変えたときは同期タスクを積まない（null）", async () => {
      const { deps, spies } = createDeps();

      await editReservationDirectlyUseCase(
        deps,
        argsWith({
          headCount: 10,
          note: "直接変更備考",
        }),
      );

      expect(spies.applyContentEdit).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        null,
      );
    });
  });
});
