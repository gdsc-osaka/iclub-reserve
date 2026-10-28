import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vite-plus/test";

import { AuditLogAction, type AuditLogDraft } from "~/domain/audit-log";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import { MembershipErrorCode, MembershipRole, type StoredMembership } from "~/domain/membership";
import {
  ReservationErrorCode,
  ReservationField,
  ReservationStatus,
  UnlockArrangement,
  type ApplyStatusTransitionArgs,
  type Reservation,
} from "~/domain/reservation";
import type { ReservationMessage } from "~/domain/reservation/message";
import { ReservationTransition } from "~/domain/reservation/transition";
import type {
  ReservationMailAudience,
  ReservationMessageAudience,
} from "~/query/reservation/reservation-mail-recipients";
import {
  fakeMailOutboxNotifier,
  fakeMembershipRepository,
  fakeReservationMailRecipientsQuery,
  fakeReservationRepository,
} from "~/testing/fakes";
import {
  changeReservationStatusUseCase,
  type ChangeReservationStatusArgs,
  type ChangeReservationStatusDeps,
} from "./change-reservation-status";

/** 1789866000000 ミリ秒。通知の idempotencyKey に更新日時として入る */
const testNow = new Date("2026-09-20T10:00:00+09:00");
/** 予約を読んだときの更新日時。条件付き更新の条件（expectedUpdatedAt）に渡る */
const readAt = new Date("2026-09-20T09:00:00+09:00");

const baseProvisionalReservation: Reservation = {
  id: "res_provisional_01",
  groupId: "grp_robotics",
  facilityId: "fac_room_a",
  startAt: new Date("2026-09-25T10:00:00+09:00"),
  endAt: new Date("2026-09-25T12:00:00+09:00"),
  headCount: 4,
  note: null,
  status: ReservationStatus.Provisional,
  statusReason: null,
  unlockArrangement: null,
  createdBy: "usr_student_01",
  createdAt: new Date("2026-09-20T09:00:00+09:00"),
  requestedAt: new Date("2026-09-20T09:00:00+09:00"),
  updatedAt: readAt,
};

const baseApprovedReservation: Reservation = {
  ...baseProvisionalReservation,
  id: "res_approved_01",
  status: ReservationStatus.Approved,
};

/** 予約の団体（grp_robotics）でのメンバーとしての所属 */
const memberMembership: StoredMembership = {
  id: "gm_memberMembership",
  groupId: "grp_robotics",
  userId: "usr_student_01",
  role: MembershipRole.Member,
};

const defaultAudience: ReservationMailAudience = {
  groupMembers: [
    {
      userId: "usr_student_01",
      address: "student@example.com",
      name: "学生代表",
    },
  ],
  staff: [
    {
      userId: "usr_staff_01",
      address: "staff@example.com",
      name: "事務局スタッフ",
    },
  ],
};

/** メッセージ通知（EVT-008）の宛先候補。承認と同時にメッセージを送ったときに引く */
const defaultMessageAudience: ReservationMessageAudience = {
  staff: defaultAudience.staff,
  groupMembers: defaultAudience.groupMembers,
  priorGroupSideSenders: [
    { userId: "usr_member_01", address: "member@example.com", name: "問い合わせた部員" },
  ],
};

const createMockDeps = (options?: {
  reservation?: Reservation | null;
  /** 予約の団体での所属。null は所属していないことを表す */
  membership?: StoredMembership | null;
  /** 所属の確認が DB エラーになる場合 */
  membershipDbError?: boolean;
  hasOverlap?: boolean;
  /** 条件付き更新が 1 件更新できたか。false は同時操作との競合を表す */
  applied?: boolean;
  enqueuedMailIds?: readonly string[];
  audience?: ReservationMailAudience;
  audienceError?: boolean;
  messageAudience?: ReservationMessageAudience;
}) => {
  const res = options?.reservation !== undefined ? options.reservation : baseProvisionalReservation;
  const membership = options?.membership === undefined ? memberMembership : options.membership;
  const hasOverlap = options?.hasOverlap ?? false;
  const applied = options?.applied ?? true;
  const enqueuedMailIds = options?.enqueuedMailIds ?? (applied ? ["outbox_mock_01"] : []);
  const audience = options?.audience ?? defaultAudience;

  const findById = vi.fn((_id: string) =>
    res
      ? okAsync(res)
      : errAsync({
          code: ReservationErrorCode.NotFound,
          message: "Reservation not Found",
        }),
  );

  const existsApprovedOverlap = vi.fn((_args: unknown) => okAsync(hasOverlap));
  const applyStatusTransition = vi.fn(
    (
      _args: ApplyStatusTransitionArgs,
      _mails: readonly MailDraft[],
      _auditLog?: AuditLogDraft,
      _calendarSync?: unknown,
      _message?: ReservationMessage | null,
    ) => okAsync({ applied, enqueuedMailIds }),
  );
  const create = vi.fn((_res: unknown, _mails: unknown) => okAsync({ enqueuedMailIds: [] }));

  const reservationRepository = fakeReservationRepository({
    findById,
    create,
    existsApprovedOverlap,
    applyStatusTransition,
  });

  const findByGroupAndUser = vi.fn((_groupId: string, _userId: string) =>
    options?.membershipDbError === true
      ? errAsync({ code: MembershipErrorCode.DatabaseError, message: "db down" })
      : okAsync(membership),
  );
  const membershipRepository = fakeMembershipRepository({
    findByGroupAndUser,
  });

  const findByReservationId = vi.fn((_reservationId: string) =>
    options?.audienceError === true
      ? errAsync({ code: "DATABASE_ERROR" as const, message: "DB error" })
      : okAsync(audience),
  );
  const findForMessage = vi.fn((_reservationId: string) =>
    okAsync(options?.messageAudience ?? defaultMessageAudience),
  );
  const reservationMailRecipientsQuery = fakeReservationMailRecipientsQuery({
    findByReservationId,
    findForMessage,
  });

  const notifyEnqueued = vi.fn((_outboxIds: readonly string[]) => undefined);
  const mailOutboxNotifier = fakeMailOutboxNotifier({ notifyEnqueued });

  const deps: ChangeReservationStatusDeps = {
    reservationRepository,
    membershipRepository,
    reservationMailRecipientsQuery,
    mailOutboxNotifier,
  };

  return {
    deps,
    spies: {
      findById,
      existsApprovedOverlap,
      applyStatusTransition,
      findByGroupAndUser,
      findByReservationId,
      findForMessage,
      notifyEnqueued,
    },
  };
};

describe("changeReservationStatusUseCase", () => {
  describe("成功パターン（5つの遷移）", () => {
    it("1. 団体メンバーが仮予約を取り消す（provisional → withdrawn）", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseProvisionalReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Withdraw,
        appBaseUrl: "https://reserve.example.com",
        reason: "都合がつかなくなったため",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);

      const value = result._unsafeUnwrap();
      expect(value.status).toBe(ReservationStatus.Withdrawn);
      expect(value.statusReason).toBe("都合がつかなくなったため");

      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        {
          id: "res_provisional_01",
          expectedStatus: ReservationStatus.Provisional,
          expectedUpdatedAt: readAt,
          status: ReservationStatus.Withdrawn,
          statusReason: "都合がつかなくなったため",
          updatedAt: testNow,
          requireNoApprovedOverlap: false,
        },
        [
          expect.objectContaining({
            idempotencyKey: "reservation:withdrawn:res_provisional_01:1789866000000:usr_student_01",
            to: { address: "student@example.com", name: "学生代表" },
            subject: "【i-Club 予約システム】施設・設備の仮予約が取り消されました",
            text: expect.stringContaining("都合がつかなくなったため"),
          }),
        ],
        {
          occurredAt: testNow,
          actorId: "usr_student_01",
          actedAsStaff: false,
          action: AuditLogAction.ReservationWithdraw,
          targetId: "res_provisional_01",
          groupId: "grp_robotics",
          changes: {
            status: { before: "provisional", after: "withdrawn" },
            status_reason: { before: null, after: "都合がつかなくなったため" },
          },
        },
        null,
        null,
      );
    });

    it("2. 団体メンバーが承認済み予約をキャンセルする（approved → cancelled）", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseApprovedReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_approved_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Cancel,
        appBaseUrl: "https://reserve.example.com",
        reason: "イベント延期のため",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);

      const value = result._unsafeUnwrap();
      expect(value.status).toBe(ReservationStatus.Cancelled);
      expect(value.statusReason).toBe("イベント延期のため");

      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        {
          id: "res_approved_01",
          expectedStatus: ReservationStatus.Approved,
          expectedUpdatedAt: readAt,
          status: ReservationStatus.Cancelled,
          statusReason: "イベント延期のため",
          updatedAt: testNow,
          requireNoApprovedOverlap: false,
        },
        [
          expect.objectContaining({
            idempotencyKey: "reservation:cancelled:res_approved_01:1789866000000:usr_student_01",
            to: { address: "student@example.com", name: "学生代表" },
            subject: "【i-Club 予約システム】施設・設備の利用予約がキャンセルされました",
            text: expect.stringContaining("イベント延期のため"),
          }),
          expect.objectContaining({
            idempotencyKey: "reservation:cancelled:res_approved_01:1789866000000:usr_staff_01",
            to: { address: "staff@example.com", name: "事務局スタッフ" },
            subject: "【i-Club 予約システム】施設・設備の利用予約がキャンセルされました",
            text: expect.stringContaining("イベント延期のため"),
          }),
        ],
        {
          occurredAt: testNow,
          actorId: "usr_student_01",
          actedAsStaff: false,
          action: AuditLogAction.ReservationCancel,
          targetId: "res_approved_01",
          groupId: "grp_robotics",
          changes: {
            status: { before: "approved", after: "cancelled" },
            status_reason: { before: null, after: "イベント延期のため" },
          },
        },
        {
          reservationId: "res_approved_01",
          previousFacilityId: null,
        },
        null,
      );
    });

    it("3. 事務局が仮予約を承認する（provisional → approved, 重複なし、承認通知メール積立）", async () => {
      const { deps, spies } = createMockDeps({
        reservation: baseProvisionalReservation,
        hasOverlap: false,
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        unlockArrangement: UnlockArrangement.Required,
        appBaseUrl: "https://reserve.example.com",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);

      const value = result._unsafeUnwrap();
      expect(value.status).toBe(ReservationStatus.Approved);
      expect(value.statusReason).toBeNull();

      expect(spies.existsApprovedOverlap).toHaveBeenCalledWith({
        facilityId: "fac_room_a",
        startAt: baseProvisionalReservation.startAt,
        endAt: baseProvisionalReservation.endAt,
      });
      expect(spies.findByReservationId).toHaveBeenCalledWith("res_provisional_01");

      // 承認は重なりの確認（COND-001）と通知メール（EVT-005）も更新に含める
      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        {
          id: "res_provisional_01",
          expectedStatus: ReservationStatus.Provisional,
          expectedUpdatedAt: readAt,
          status: ReservationStatus.Approved,
          statusReason: null,
          unlockArrangement: UnlockArrangement.Required,
          updatedAt: testNow,
          requireNoApprovedOverlap: true,
        },
        [
          expect.objectContaining({
            idempotencyKey: "reservation:approved:res_provisional_01:1789866000000:usr_student_01",
            to: { address: "student@example.com", name: "学生代表" },
            subject: expect.stringContaining("承認されました"),
          }),
        ],
        {
          occurredAt: testNow,
          actorId: "usr_staff_01",
          actedAsStaff: true,
          action: AuditLogAction.ReservationApprove,
          targetId: "res_provisional_01",
          groupId: "grp_robotics",
          changes: {
            status: { before: "provisional", after: "approved" },
            status_reason: { before: null, after: null },
            unlock_arrangement: { before: null, after: "required" },
          },
        },
        {
          reservationId: "res_provisional_01",
          previousFacilityId: null,
        },
        null,
      );
    });

    it("3b. 承認時に宛先が複数ある場合は全宛先分の MailDraft が渡される（EVT-005）", async () => {
      const audience: ReservationMailAudience = {
        groupMembers: [
          { userId: "usr_student_01", address: "student@example.com", name: "申請者" },
          { userId: "usr_admin_01", address: "admin1@example.com", name: "管理者1" },
          { userId: "usr_admin_02", address: "admin2@example.com", name: "管理者2" },
        ],
        staff: [{ userId: "usr_staff_01", address: "staff@example.com", name: "事務局スタッフ" }],
      };
      const { deps, spies } = createMockDeps({
        reservation: baseProvisionalReservation,
        audience,
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        unlockArrangement: UnlockArrangement.Required,
        appBaseUrl: "https://reserve.example.com",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);

      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({
            idempotencyKey: "reservation:approved:res_provisional_01:1789866000000:usr_student_01",
            to: { address: "student@example.com", name: "申請者" },
          }),
          expect.objectContaining({
            idempotencyKey: "reservation:approved:res_provisional_01:1789866000000:usr_admin_01",
            to: { address: "admin1@example.com", name: "管理者1" },
          }),
          expect.objectContaining({
            idempotencyKey: "reservation:approved:res_provisional_01:1789866000000:usr_admin_02",
            to: { address: "admin2@example.com", name: "管理者2" },
          }),
        ]),
        expect.objectContaining({
          action: AuditLogAction.ReservationApprove,
          actedAsStaff: true,
        }),
        {
          reservationId: "res_provisional_01",
          previousFacilityId: null,
        },
        null,
      );
      const passedMails = (spies.applyStatusTransition.mock.calls[0] as unknown[])[1] as unknown[];
      expect(passedMails).toHaveLength(3);
    });

    it("4. 事務局が理由を入力して仮予約を却下する（provisional → rejected, 却下通知メール積立）", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseProvisionalReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Reject,
        appBaseUrl: "https://reserve.example.com",
        reason: "設備点検のため利用できません",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);

      const value = result._unsafeUnwrap();
      expect(value.status).toBe(ReservationStatus.Rejected);
      expect(value.statusReason).toBe("設備点検のため利用できません");

      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        {
          id: "res_provisional_01",
          expectedStatus: ReservationStatus.Provisional,
          expectedUpdatedAt: readAt,
          status: ReservationStatus.Rejected,
          statusReason: "設備点検のため利用できません",
          updatedAt: testNow,
          requireNoApprovedOverlap: false,
        },
        [
          expect.objectContaining({
            idempotencyKey: "reservation:rejected:res_provisional_01:1789866000000:usr_student_01",
            to: { address: "student@example.com", name: "学生代表" },
            subject: "【i-Club 予約システム】施設・設備の利用予約が却下されました",
            text: expect.stringContaining("理由: 設備点検のため利用できません"),
          }),
        ],
        {
          occurredAt: testNow,
          actorId: "usr_staff_01",
          actedAsStaff: true,
          action: AuditLogAction.ReservationReject,
          targetId: "res_provisional_01",
          groupId: "grp_robotics",
          changes: {
            status: { before: "provisional", after: "rejected" },
            status_reason: { before: null, after: "設備点検のため利用できません" },
          },
        },
        null,
        null,
      );
    });

    it("5. 事務局が理由を入力して承認済み予約をキャンセルする（approved → cancelled_by_staff, 事務局キャンセル通知メール積立）", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseApprovedReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_approved_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.StaffCancel,
        appBaseUrl: "https://reserve.example.com",
        reason: "大学の公式行事のため",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);

      const value = result._unsafeUnwrap();
      expect(value.status).toBe(ReservationStatus.CancelledByStaff);
      expect(value.statusReason).toBe("大学の公式行事のため");

      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        {
          id: "res_approved_01",
          expectedStatus: ReservationStatus.Approved,
          expectedUpdatedAt: readAt,
          status: ReservationStatus.CancelledByStaff,
          statusReason: "大学の公式行事のため",
          updatedAt: testNow,
          requireNoApprovedOverlap: false,
        },
        [
          expect.objectContaining({
            idempotencyKey:
              "reservation:cancelledByStaff:res_approved_01:1789866000000:usr_student_01",
            to: { address: "student@example.com", name: "学生代表" },
            subject:
              "【i-Club 予約システム】施設・設備の利用予約が事務局によりキャンセルされました",
            text: expect.stringContaining("理由: 大学の公式行事のため"),
          }),
        ],
        {
          occurredAt: testNow,
          actorId: "usr_staff_01",
          actedAsStaff: true,
          action: AuditLogAction.ReservationStaffCancel,
          targetId: "res_approved_01",
          groupId: "grp_robotics",
          changes: {
            status: { before: "approved", after: "cancelled_by_staff" },
            status_reason: { before: null, after: "大学の公式行事のため" },
          },
        },
        {
          reservationId: "res_approved_01",
          previousFacilityId: null,
        },
        null,
      );
    });
  });

  describe("所属の引き方（COND-009）", () => {
    it("事務局だけの操作では所属を引かない（判定が isStaff しか見ないため）", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseProvisionalReservation });

      await changeReservationStatusUseCase(deps, {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        appBaseUrl: "https://reserve.example.com",
        reason: null,
      });

      expect(spies.findByGroupAndUser).not.toHaveBeenCalled();
    });

    it("取り消し・キャンセルでは、予約が属する団体での所属を引く", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseProvisionalReservation });

      await changeReservationStatusUseCase(deps, {
        reservationId: "res_provisional_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Withdraw,
        appBaseUrl: "https://reserve.example.com",
        reason: "都合がつかなくなったため",
      });

      expect(spies.findByGroupAndUser).toHaveBeenCalledWith("grp_robotics", "usr_student_01");
    });

    /*
     * COND-030 (1): 事務局の画面では取り消し・キャンセルはできず（事務局キャンセルを使う）、
     * 所属も引かない。団体として取り消すには利用者の画面（isStaff: false）から行う。
     */
    it("事務局であっても団体の予約を取り消すには利用者の画面から行い、所属を引く", async () => {
      const { deps, spies } = createMockDeps({
        reservation: baseProvisionalReservation,
        membership: { ...memberMembership, userId: "usr_staff_01" },
      });

      const result = await changeReservationStatusUseCase(deps, {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: false,
        transition: ReservationTransition.Withdraw,
        appBaseUrl: "https://reserve.example.com",
        reason: "都合がつかなくなったため",
      });

      expect(spies.findByGroupAndUser).toHaveBeenCalledWith("grp_robotics", "usr_staff_01");
      expect(result.isOk()).toBe(true);
    });

    it("事務局の画面から取り消そうとしても所属は引かれず権限エラーになる", async () => {
      const { deps, spies } = createMockDeps({
        reservation: baseProvisionalReservation,
        membership: { ...memberMembership, userId: "usr_staff_01" },
      });

      const result = await changeReservationStatusUseCase(deps, {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Withdraw,
        appBaseUrl: "https://reserve.example.com",
        reason: "都合がつかなくなったため",
      });

      expect(spies.findByGroupAndUser).not.toHaveBeenCalled();
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Forbidden);
    });

    it("所属の確認に失敗したら DatabaseError を返す", async () => {
      const { deps } = createMockDeps({
        reservation: baseProvisionalReservation,
        membershipDbError: true,
      });

      const result = await changeReservationStatusUseCase(deps, {
        reservationId: "res_provisional_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Withdraw,
        appBaseUrl: "https://reserve.example.com",
        reason: "都合がつかなくなったため",
      });

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.DatabaseError);
    });
  });

  describe("失敗パターン", () => {
    it("理由なしの却下は弾かれる（COND-002）", async () => {
      const { deps } = createMockDeps({ reservation: baseProvisionalReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Reject,
        appBaseUrl: "https://reserve.example.com",
        reason: "   ",
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.InvalidInput);
      expect(result._unsafeUnwrapErr().userMessage).toContain("却下理由を入力してください");
    });

    it("理由なしの事務局キャンセルは弾かれる（COND-002）", async () => {
      const { deps } = createMockDeps({ reservation: baseApprovedReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_approved_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.StaffCancel,
        appBaseUrl: "https://reserve.example.com",
        reason: "",
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.InvalidInput);
      expect(result._unsafeUnwrapErr().userMessage).toContain("キャンセル理由を入力してください");
    });

    it("理由なしの取り消しは弾かれ、予約を更新しない（COND-002）", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseProvisionalReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Withdraw,
        appBaseUrl: "https://reserve.example.com",
        reason: null,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.InvalidInput);
      expect(result._unsafeUnwrapErr().userMessage).toContain("取り消し理由を入力してください");
      expect(spies.applyStatusTransition).not.toHaveBeenCalled();
    });

    it("理由なしのキャンセルは弾かれ、予約を更新しない（COND-002）", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseApprovedReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_approved_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Cancel,
        appBaseUrl: "https://reserve.example.com",
        reason: "   ",
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.InvalidInput);
      expect(result._unsafeUnwrapErr().userMessage).toContain("キャンセル理由を入力してください");
      expect(spies.applyStatusTransition).not.toHaveBeenCalled();
    });

    /*
     * 権限を理由より先に確かめる。所属していない人に「理由を入力してください」と返すと、
     * 入力し直しても結局は弾かれる。
     */
    it("所属していない人の取り消しは、理由が空でも Forbidden になる", async () => {
      const { deps } = createMockDeps({
        reservation: baseProvisionalReservation,
        membership: null,
      });

      const result = await changeReservationStatusUseCase(deps, {
        reservationId: "res_provisional_01",
        actorUserId: "usr_other_01",
        isStaff: false,
        transition: ReservationTransition.Withdraw,
        appBaseUrl: "https://reserve.example.com",
        reason: "",
      });

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Forbidden);
    });

    it("他団体所属のユーザーによる取り消しは拒否される（自団体の突き合わせ）", async () => {
      const { deps } = createMockDeps({
        reservation: baseProvisionalReservation,
        membership: null, // 予約の "grp_robotics" に所属していない
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_other_01",
        isStaff: false,
        transition: ReservationTransition.Withdraw,
        appBaseUrl: "https://reserve.example.com",
        reason: "都合がつかなくなったため",
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Forbidden);
    });

    it("非スタッフによる承認は拒否される", async () => {
      const { deps } = createMockDeps({ reservation: baseProvisionalReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Approve,
        appBaseUrl: "https://reserve.example.com",
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Forbidden);
    });

    it.each([
      ReservationTransition.Approve,
      ReservationTransition.Reject,
      ReservationTransition.StaffCancel,
    ])("非スタッフの %s は、予約を引く前に拒否される", async (transition) => {
      const { deps, spies } = createMockDeps({ reservation: baseProvisionalReservation });

      const result = await changeReservationStatusUseCase(deps, {
        reservationId: "res_provisional_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition,
        appBaseUrl: "https://reserve.example.com",
        reason: "理由",
      });

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Forbidden);
      expect(spies.findById).not.toHaveBeenCalled();
    });

    it("非スタッフの承認は、予約が無くても同じ Forbidden になる（予約の有無が伝わらない）", async () => {
      // 予約を引いてから確かめると、無い予約だけ NotFound になり、応答の違いから有無が分かってしまう
      const { deps: existing } = createMockDeps({ reservation: baseProvisionalReservation });
      const { deps: missing } = createMockDeps({ reservation: null });
      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Approve,
        appBaseUrl: "https://reserve.example.com",
      };

      const fromExisting = await changeReservationStatusUseCase(existing, args);
      const fromMissing = await changeReservationStatusUseCase(missing, args);

      expect(fromMissing._unsafeUnwrapErr()).toEqual(fromExisting._unsafeUnwrapErr());
    });

    it("承認時に同一施設・同一時間帯に承認済みの重複予約が存在する場合は拒否される（COND-001）", async () => {
      const { deps, spies } = createMockDeps({
        reservation: baseProvisionalReservation,
        hasOverlap: true, // 重複あり
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        unlockArrangement: UnlockArrangement.Required,
        appBaseUrl: "https://reserve.example.com",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Conflict);
      expect(result._unsafeUnwrapErr().userMessage).toContain("先にそちらをキャンセルしてください");
      expect(spies.applyStatusTransition).not.toHaveBeenCalled();
    });

    it("不正な遷移（例: 承認済み予約の取り消し）は拒否される", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseApprovedReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_approved_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Withdraw,
        appBaseUrl: "https://reserve.example.com",
        reason: "都合がつかなくなったため",
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.InvalidTransition);
      expect(spies.applyStatusTransition).not.toHaveBeenCalled();
    });

    it("条件付き更新が 0 件だった場合は競合として扱う（同時に別の操作が反映された）", async () => {
      const { deps, spies } = createMockDeps({
        reservation: baseProvisionalReservation,
        applied: false, // 読んでから書くまでの間に、別の操作が先に反映された
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        unlockArrangement: UnlockArrangement.Required,
        appBaseUrl: "https://reserve.example.com",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Conflict);
      expect(result._unsafeUnwrapErr().userMessage).toContain("読み込み直して");
      // 0 件更新なら outbox にも積まれていないので、配送を依頼してはいけない
      expect(spies.notifyEnqueued).not.toHaveBeenCalled();
    });

    it("存在しない予約 ID を指定した場合は NOT_FOUND エラーとなる", async () => {
      const { deps } = createMockDeps({ reservation: null });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_non_existent",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Withdraw,
        appBaseUrl: "https://reserve.example.com",
        reason: "都合がつかなくなったため",
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.NotFound);
    });

    it("宛先取得に失敗した場合は DatabaseError となり applyStatusTransition は呼ばれない", async () => {
      const { deps, spies } = createMockDeps({
        reservation: baseProvisionalReservation,
        audienceError: true,
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        unlockArrangement: UnlockArrangement.Required,
        appBaseUrl: "https://reserve.example.com",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.DatabaseError);
      expect(spies.applyStatusTransition).not.toHaveBeenCalled();
    });

    it("状態更新に成功したとき、積まれたメールの ID で即時配送が依頼される（ADR-002 決定 1 / 決定 2.1）", async () => {
      const expectedIds = ["mail_outbox_01", "mail_outbox_02"];
      const { deps, spies } = createMockDeps({
        reservation: baseProvisionalReservation,
        enqueuedMailIds: expectedIds,
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        unlockArrangement: UnlockArrangement.Required,
        appBaseUrl: "https://reserve.example.com",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().status).toBe(ReservationStatus.Approved);
      expect(spies.notifyEnqueued).toHaveBeenCalledWith(expectedIds);
    });

    it("即時配送の依頼が例外を投げても、予約の更新は成功として返す（ADR-002 決定 1）", async () => {
      const { deps } = createMockDeps({ reservation: baseProvisionalReservation });
      /*
       * ポートの取り決めでは notifyEnqueued は失敗を返さないが、実装が約束を破った場合に
       * 「DB は更新済みなのに画面はエラー」になると利用者は操作をやり直すしかなくなる。
       * 依頼の失敗が業務処理を巻き込まないことを、ここで固定しておく。
       */
      vi.mocked(deps.mailOutboxNotifier.notifyEnqueued).mockImplementation(() => {
        throw new Error("queue is unavailable");
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        unlockArrangement: UnlockArrangement.Required,
        appBaseUrl: "https://reserve.example.com",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().status).toBe(ReservationStatus.Approved);
    });
  });

  describe("カレンダー同期タスク草稿の作成（toCalendarSyncDraft）", () => {
    it("承認時は同期タスク草稿が渡される", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseProvisionalReservation });
      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        unlockArrangement: UnlockArrangement.Required,
        appBaseUrl: "https://reserve.example.com",
        now: testNow,
      };

      await changeReservationStatusUseCase(deps, args);

      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        {
          reservationId: "res_provisional_01",
          previousFacilityId: null,
        },
        null,
      );
    });

    it("却下時は同期タスク草稿が null になる", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseProvisionalReservation });
      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Reject,
        appBaseUrl: "https://reserve.example.com",
        reason: "施設利用基準を満たしていないため",
        now: testNow,
      };

      await changeReservationStatusUseCase(deps, args);

      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        null,
        null,
      );
    });

    it("承認済みのキャンセル時は同期タスク草稿が渡される", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseApprovedReservation });
      const args: ChangeReservationStatusArgs = {
        reservationId: "res_approved_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Cancel,
        appBaseUrl: "https://reserve.example.com",
        reason: "都合によりキャンセル",
        now: testNow,
      };

      await changeReservationStatusUseCase(deps, args);

      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        {
          reservationId: "res_approved_01",
          previousFacilityId: null,
        },
        null,
      );
    });

    it("事務局キャンセル時は同期タスク草稿が渡される", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseApprovedReservation });
      const args: ChangeReservationStatusArgs = {
        reservationId: "res_approved_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.StaffCancel,
        appBaseUrl: "https://reserve.example.com",
        reason: "緊急メンテナンスのため",
        now: testNow,
      };

      await changeReservationStatusUseCase(deps, args);

      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        {
          reservationId: "res_approved_01",
          previousFacilityId: null,
        },
        null,
      );
    });
  });

  describe("解錠の手配（unlockArrangement / COND-027）", () => {
    it("承認時に解錠の手配が無いと InvalidInput（field: UnlockArrangement）で、書き込みもメールも起きない", async () => {
      const { deps, spies } = createMockDeps({
        reservation: baseProvisionalReservation,
        hasOverlap: false,
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        unlockArrangement: null,
        appBaseUrl: "https://reserve.example.com",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);

      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(ReservationErrorCode.InvalidInput);
      expect(error.field).toBe(ReservationField.UnlockArrangement);
      expect(error.userMessage).toBe(
        "解錠の手配を「要手配」「手配済み」「不要」から選んでください。",
      );

      expect(spies.applyStatusTransition).not.toHaveBeenCalled();
      expect(spies.notifyEnqueued).not.toHaveBeenCalled();
    });

    it("承認時に選んだ値が applyStatusTransition に渡され、changes に unlock_arrangement が入る", async () => {
      const { deps, spies } = createMockDeps({
        reservation: baseProvisionalReservation,
        hasOverlap: false,
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        unlockArrangement: UnlockArrangement.Arranged,
        appBaseUrl: "https://reserve.example.com",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);

      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          unlockArrangement: UnlockArrangement.Arranged,
        }),
        expect.anything(),
        expect.objectContaining({
          changes: expect.objectContaining({
            unlock_arrangement: { before: null, after: "arranged" },
          }),
        }),
        expect.anything(),
        null,
      );
    });

    it("理由が要る操作（却下など）では、解錠の手配の値を渡しても列にも changes にも出ない", async () => {
      const { deps, spies } = createMockDeps({
        reservation: baseProvisionalReservation,
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Reject,
        reason: "定員超過のため",
        unlockArrangement: UnlockArrangement.Required, // 渡しても使われない
        appBaseUrl: "https://reserve.example.com",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);

      const [statusArgs, , auditLog] = spies.applyStatusTransition.mock.calls[0] ?? [];
      expect(statusArgs?.unlockArrangement).toBeUndefined();
      expect("unlock_arrangement" in (auditLog?.changes ?? {})).toBe(false);
    });

    it("権限の無い人には、解錠の手配の検証より先に権限のエラーが返る", async () => {
      const { deps, spies } = createMockDeps({
        reservation: baseProvisionalReservation,
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_student_01",
        isStaff: false, // 事務局でない
        transition: ReservationTransition.Approve,
        unlockArrangement: null, // 解錠の手配も未指定
        appBaseUrl: "https://reserve.example.com",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);

      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(ReservationErrorCode.Forbidden);
      expect(spies.applyStatusTransition).not.toHaveBeenCalled();
    });
  });

  describe("承認と同時に送るメッセージ（REQ-048 / COND-023）", () => {
    const approveArgs: ChangeReservationStatusArgs = {
      reservationId: "res_provisional_01",
      actorUserId: "usr_staff_01",
      isStaff: true,
      transition: ReservationTransition.Approve,
      unlockArrangement: UnlockArrangement.Arranged,
      appBaseUrl: "https://reserve.example.com",
      now: testNow,
    };

    it("添えたメッセージを承認と同じ batch に渡し、本文を載せた承認通知だけを積む（EVT-008 は積まない）", async () => {
      const { deps, spies } = createMockDeps();

      const result = await changeReservationStatusUseCase(deps, {
        ...approveArgs,
        message: "  カードキーは事務局で受け取ってください。\r\n返却は翌朝で構いません。  ",
      });
      expect(result.isOk()).toBe(true);

      // 承認だけのときの宛先ではなく、メッセージの宛先候補を引く
      expect(spies.findForMessage).toHaveBeenCalledWith("res_provisional_01");
      expect(spies.findByReservationId).not.toHaveBeenCalled();

      const [, mails, , , message] = spies.applyStatusTransition.mock.calls[0] ?? [];
      // 本文は UC-009 と同じく正規化し、送った日時は承認と同じにする。承認は事務局の画面からなので事務局としての送信
      expect(message).toEqual({
        id: expect.any(String),
        reservationId: "res_provisional_01",
        senderId: "usr_staff_01",
        sentAsStaff: true,
        body: "カードキーは事務局で受け取ってください。\n返却は翌朝で構いません。",
        sentAt: testNow,
      });
      expect(result._unsafeUnwrap().messageId).toBe(message?.id);

      // 宛先は申請者に、過去に団体側として送った部員を加えたもの。どれも承認通知の 1 通
      expect(mails).toEqual([
        expect.objectContaining({
          idempotencyKey: "reservation:approved:res_provisional_01:1789866000000:usr_student_01",
          to: { address: "student@example.com", name: "学生代表" },
          subject: "【i-Club 予約システム】施設・設備の利用予約が承認されました",
          text: expect.stringContaining(
            "事務局からのメッセージ:\nカードキーは事務局で受け取ってください。\n返却は翌朝で構いません。",
          ),
        }),
        expect.objectContaining({
          idempotencyKey: "reservation:approved:res_provisional_01:1789866000000:usr_member_01",
          to: { address: "member@example.com", name: "問い合わせた部員" },
        }),
      ]);
    });

    it("空白と改行だけなら添えなかったものとして扱い、承認だけのときと同じ宛先で通知する", async () => {
      const { deps, spies } = createMockDeps();

      const result = await changeReservationStatusUseCase(deps, {
        ...approveArgs,
        message: " \n　 ",
      });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().messageId).toBeNull();

      expect(spies.findByReservationId).toHaveBeenCalledWith("res_provisional_01");
      expect(spies.findForMessage).not.toHaveBeenCalled();
      const [, mails, , , message] = spies.applyStatusTransition.mock.calls[0] ?? [];
      expect(message).toBeNull();
      expect(mails).toHaveLength(1);
      expect(mails?.[0]?.text).not.toContain("事務局からのメッセージ");
    });

    it("本文が 2000 文字を超えたら InvalidInput（field: MessageBody）で、承認もしない", async () => {
      const { deps, spies } = createMockDeps();

      const result = await changeReservationStatusUseCase(deps, {
        ...approveArgs,
        message: "あ".repeat(2001),
      });
      expect(result.isErr()).toBe(true);

      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(ReservationErrorCode.InvalidInput);
      expect(error.field).toBe(ReservationField.MessageBody);
      expect(error.userMessage).toBe("メッセージは2000文字以内で入力してください。");
      expect(spies.applyStatusTransition).not.toHaveBeenCalled();
      expect(spies.notifyEnqueued).not.toHaveBeenCalled();
    });

    it("承認済みの予約と重なって承認できないときは、メッセージも書かない（COND-001）", async () => {
      const { deps, spies } = createMockDeps({ hasOverlap: true });

      const result = await changeReservationStatusUseCase(deps, {
        ...approveArgs,
        message: "よろしくお願いします。",
      });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Conflict);
      expect(spies.applyStatusTransition).not.toHaveBeenCalled();
    });

    it("条件付き更新が競合で 0 件なら Conflict を返し、即時配送も依頼しない", async () => {
      const { deps, spies } = createMockDeps({ applied: false });

      const result = await changeReservationStatusUseCase(deps, {
        ...approveArgs,
        message: "よろしくお願いします。",
      });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Conflict);
      // メッセージを書かせるかどうかは、更新と同じ batch の条件で Repository が決める
      expect(spies.applyStatusTransition).toHaveBeenCalledTimes(1);
      expect(spies.notifyEnqueued).not.toHaveBeenCalled();
    });

    it("却下では、メッセージの値を渡しても読まない（承認のときだけ使う）", async () => {
      const { deps, spies } = createMockDeps();

      const result = await changeReservationStatusUseCase(deps, {
        ...approveArgs,
        transition: ReservationTransition.Reject,
        reason: "定員超過のため",
        message: "あ".repeat(2001), // 読まれるなら InvalidInput になる
      });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().messageId).toBeNull();

      expect(spies.findForMessage).not.toHaveBeenCalled();
      const [, , , , message] = spies.applyStatusTransition.mock.calls[0] ?? [];
      expect(message).toBeNull();
    });

    it("権限の無い人には、本文の検証より先に権限のエラーが返る", async () => {
      const { deps, spies } = createMockDeps();

      const result = await changeReservationStatusUseCase(deps, {
        ...approveArgs,
        actorUserId: "usr_student_01",
        isStaff: false,
        message: "あ".repeat(2001),
      });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Forbidden);
      expect(spies.applyStatusTransition).not.toHaveBeenCalled();
    });
  });
});
