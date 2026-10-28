import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vite-plus/test";

import { AuditLogAction, type AuditLogDraft } from "~/domain/audit-log";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import type { ReservationMessageAudience } from "~/domain/mail/reservation-message-mail";
import { MembershipRole, type StoredMembership } from "~/domain/membership";
import {
  ReservationErrorCode,
  ReservationField,
  ReservationStatus,
  UnlockArrangement,
  type ApplyUnlockArrangementUpdateArgs,
  type ApplyUnlockArrangementUpdateOutcome,
  type Reservation,
} from "~/domain/reservation";
import {
  RESERVATION_MESSAGE_BODY_MAX_LENGTH,
  type ReservationMessage,
} from "~/domain/reservation/message";
import {
  fakeMailOutboxNotifier,
  fakeMembershipRepository,
  fakeReservationMailRecipientsQuery,
  fakeReservationRepository,
} from "~/testing/fakes";
import {
  updateUnlockArrangementUseCase,
  type UpdateUnlockArrangementArgs,
  type UpdateUnlockArrangementDeps,
} from "./update-unlock-arrangement";

const readAt = new Date("2026-09-20T09:00:00+09:00");
const testNow = new Date("2026-09-20T10:00:00+09:00");

const baseApprovedReservation: Reservation = {
  id: "res_approved_01",
  groupId: "grp_robotics",
  facilityId: "fac_room_a",
  startAt: new Date("2026-09-25T10:00:00+09:00"),
  endAt: new Date("2026-09-25T12:00:00+09:00"),
  headCount: 4,
  note: null,
  status: ReservationStatus.Approved,
  statusReason: null,
  unlockArrangement: UnlockArrangement.Required,
  createdBy: "usr_applicant",
  createdAt: readAt,
  requestedAt: readAt,
  updatedAt: readAt,
};

const userApplicant = {
  userId: "usr_applicant",
  address: "applicant@ecs.osaka-u.ac.jp",
  name: "申請者",
};
const userAdmin = {
  userId: "usr_admin",
  address: "admin@ecs.osaka-u.ac.jp",
  name: "団体管理者",
};
const userPriorSender = {
  userId: "usr_prior",
  address: "prior@ecs.osaka-u.ac.jp",
  name: "過去送信者",
};
const userStaff1 = {
  userId: "usr_staff_01",
  address: "staff1@osaka-u.ac.jp",
  name: "事務局員1",
};

const defaultAudience: ReservationMessageAudience = {
  groupMembers: [userApplicant, userAdmin],
  staff: [userStaff1],
  priorGroupSideSenders: [userPriorSender],
};

const createMockDeps = (options?: {
  reservation?: Reservation | null;
  membership?: StoredMembership | null;
  applied?: boolean;
  enqueuedMailIds?: readonly string[];
  audience?: ReservationMessageAudience;
}) => {
  const res = options?.reservation !== undefined ? options.reservation : baseApprovedReservation;
  const applied = options?.applied ?? true;
  const enqueuedMailIds = options?.enqueuedMailIds ?? (applied ? ["outbox_mock_01"] : []);
  const audience = options?.audience ?? defaultAudience;

  const findById = vi.fn((_id: string) =>
    res
      ? okAsync(res)
      : errAsync({
          code: ReservationErrorCode.NotFound,
          message: "Reservation not found",
        }),
  );

  const applyUnlockArrangementUpdate = vi.fn(
    (
      _args: ApplyUnlockArrangementUpdateArgs,
      _message: ReservationMessage | null,
      _mails: readonly MailDraft[],
      _auditLog: AuditLogDraft,
    ) =>
      okAsync<ApplyUnlockArrangementUpdateOutcome, never>({
        applied,
        enqueuedMailIds,
      }),
  );

  const reservationRepository = fakeReservationRepository({
    findById,
    applyUnlockArrangementUpdate,
  });

  const findByGroupAndUser = vi.fn((_groupId: string, _userId: string) =>
    okAsync(options?.membership ?? null),
  );
  const membershipRepository = fakeMembershipRepository({
    findByGroupAndUser,
  });

  const findForMessage = vi.fn((_reservationId: string) => okAsync(audience));
  const reservationMailRecipientsQuery = fakeReservationMailRecipientsQuery({
    findForMessage,
  });

  const notifyEnqueued = vi.fn((_outboxIds: readonly string[]) => undefined);
  const mailOutboxNotifier = fakeMailOutboxNotifier({ notifyEnqueued });

  const deps: UpdateUnlockArrangementDeps = {
    reservationRepository,
    membershipRepository,
    reservationMailRecipientsQuery,
    mailOutboxNotifier,
  };

  return {
    deps,
    spies: {
      findById,
      applyUnlockArrangementUpdate,
      findByGroupAndUser,
      findForMessage,
      notifyEnqueued,
    },
  };
};

const defaultArgs: UpdateUnlockArrangementArgs = {
  reservationId: "res_approved_01",
  actorUserId: "usr_staff_01",
  actorName: "事務局員1",
  isStaff: true,
  unlockArrangement: UnlockArrangement.Arranged,
  message: "",
  now: testNow,
  appBaseUrl: "https://reserve.example.com",
};

describe("updateUnlockArrangementUseCase", () => {
  it("事務局の画面でない（isStaff: false）と、予約を引く前に Forbidden で止まり findById が呼ばれない", async () => {
    const { deps, spies } = createMockDeps();

    const result = await updateUnlockArrangementUseCase(deps, {
      ...defaultArgs,
      isStaff: false,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.Forbidden,
      userMessage: "この操作は、事務局のみ行えます。",
    });
    expect(spies.findById).not.toHaveBeenCalled();
    expect(spies.applyUnlockArrangementUpdate).not.toHaveBeenCalled();
  });

  it.each<
    [
      string,
      { reservation?: Reservation; unlockArrangement: UnlockArrangement | null },
      { code: ReservationErrorCode; field?: ReservationField; userMessage: string },
    ]
  >([
    [
      "同じ値",
      { unlockArrangement: UnlockArrangement.Required },
      {
        code: ReservationErrorCode.InvalidInput,
        field: ReservationField.UnlockArrangement,
        userMessage: "今と同じ手配の状況です。別の状況を選んでください。",
      },
    ],
    [
      "未選択（null）",
      { unlockArrangement: null },
      {
        code: ReservationErrorCode.InvalidInput,
        field: ReservationField.UnlockArrangement,
        userMessage: "解錠の手配を「要手配」「手配済み」「不要」から選んでください。",
      },
    ],
    [
      "承認済みでない予約（仮予約）",
      {
        reservation: { ...baseApprovedReservation, status: ReservationStatus.Provisional },
        unlockArrangement: UnlockArrangement.Arranged,
      },
      {
        code: ReservationErrorCode.InvalidTransition,
        userMessage: "解錠の手配は、承認済みの予約のみ変更できます。",
      },
    ],
    [
      "終了した予約",
      {
        reservation: {
          ...baseApprovedReservation,
          endAt: new Date("2026-09-20T10:00:00+09:00"),
        },
        unlockArrangement: UnlockArrangement.Arranged,
      },
      {
        code: ReservationErrorCode.InvalidTransition,
        userMessage: "終了した予約の解錠の手配は変更できません。",
      },
    ],
  ])("%s はエラーになり、Repository の更新が呼ばれない", async (_label, overrides, expected) => {
    const { deps, spies } = createMockDeps({
      reservation: overrides.reservation,
    });

    const result = await updateUnlockArrangementUseCase(deps, {
      ...defaultArgs,
      unlockArrangement: overrides.unlockArrangement,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject(expected);
    expect(spies.applyUnlockArrangementUpdate).not.toHaveBeenCalled();
  });

  it("メッセージなし（空文字・空白だけ）のときは予約と操作履歴だけ書き、findForMessage・notifyEnqueued は呼ばない", async () => {
    for (const rawMessage of ["", "   \n\u3000 "]) {
      const { deps, spies } = createMockDeps({ enqueuedMailIds: [] });

      const result = await updateUnlockArrangementUseCase(deps, {
        ...defaultArgs,
        message: rawMessage,
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        messageSent: false,
      });

      expect(spies.findForMessage).not.toHaveBeenCalled();
      expect(spies.notifyEnqueued).not.toHaveBeenCalled();
      expect(spies.applyUnlockArrangementUpdate).toHaveBeenCalledWith(
        {
          id: "res_approved_01",
          expectedStatus: ReservationStatus.Approved,
          expectedUpdatedAt: readAt,
          unlockArrangement: UnlockArrangement.Arranged,
          updatedAt: testNow,
        },
        null,
        [],
        {
          occurredAt: testNow,
          actorId: "usr_staff_01",
          actedAsStaff: true,
          action: AuditLogAction.ReservationUnlockArrangementUpdate,
          targetId: "res_approved_01",
          groupId: "grp_robotics",
          changes: {
            unlock_arrangement: {
              before: UnlockArrangement.Required,
              after: UnlockArrangement.Arranged,
            },
          },
        },
      );
    }
  });

  it("メッセージありのときは sentAsStaff: true のメッセージと解錠の手配の文言入りメール（EVT-008）を組み立てて更新に渡し、notifyEnqueued を呼ぶ。事務局がその団体のメンバーでも所属は引かれない", async () => {
    const { deps, spies } = createMockDeps({
      membership: {
        id: "gm_staff_member",
        groupId: "grp_robotics",
        userId: "usr_staff_01",
        role: MembershipRole.Member,
      },
      enqueuedMailIds: ["mail_01", "mail_02", "mail_03"],
    });

    const result = await updateUnlockArrangementUseCase(deps, {
      ...defaultArgs,
      message: "  守衛室へ連絡しました。  ",
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      messageSent: true,
    });

    expect(spies.findByGroupAndUser).not.toHaveBeenCalled();
    expect(spies.findForMessage).toHaveBeenCalledWith("res_approved_01");
    expect(spies.applyUnlockArrangementUpdate).toHaveBeenCalledTimes(1);

    const [, savedMessage, savedMails, savedAuditLog] =
      spies.applyUnlockArrangementUpdate.mock.calls[0]!;
    expect(savedAuditLog.actedAsStaff).toBe(true);
    expect(savedAuditLog.action).toBe(AuditLogAction.ReservationUnlockArrangementUpdate);

    expect(savedMessage).not.toBeNull();
    expect(savedMessage).toMatchObject({
      reservationId: "res_approved_01",
      senderId: "usr_staff_01",
      sentAsStaff: true,
      body: "守衛室へ連絡しました。",
      sentAt: testNow,
    });

    expect(savedMails).toHaveLength(3);
    expect(savedMails.map((m) => m.to.address)).toEqual([
      userAdmin.address,
      userApplicant.address,
      userPriorSender.address,
    ]);
    for (const mail of savedMails) {
      expect(mail.text).toContain("解錠の手配が「手配済み」に更新されました。");
      expect(mail.text).toContain("守衛室へ連絡しました。");
    }

    expect(spies.notifyEnqueued).toHaveBeenCalledWith(["mail_01", "mail_02", "mail_03"]);
  });

  it("メッセージ本文が長すぎるときは validateReservationMessageBody のエラーになり、更新が呼ばれない", async () => {
    const { deps, spies } = createMockDeps();

    const result = await updateUnlockArrangementUseCase(deps, {
      ...defaultArgs,
      message: "あ".repeat(RESERVATION_MESSAGE_BODY_MAX_LENGTH + 1),
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.InvalidInput,
      field: ReservationField.MessageBody,
      userMessage: `メッセージは${RESERVATION_MESSAGE_BODY_MAX_LENGTH}文字以内で入力してください。`,
    });
    expect(spies.applyUnlockArrangementUpdate).not.toHaveBeenCalled();
  });

  it("競合（applied: false）なら Conflict になり、notifyEnqueued は呼ばれない", async () => {
    const { deps, spies } = createMockDeps({
      applied: false,
      enqueuedMailIds: [],
    });

    const result = await updateUnlockArrangementUseCase(deps, {
      ...defaultArgs,
      message: "手配済みです。",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.Conflict,
      userMessage:
        "この予約には別の操作が先に反映されました。画面を読み込み直して、状態と内容を確認してください。",
    });
    expect(spies.notifyEnqueued).not.toHaveBeenCalled();
  });
});
