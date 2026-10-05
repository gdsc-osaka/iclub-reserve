import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import type { MailDraft } from "~/domain/mail/mail-outbox";
import type { ReservationMessageAudience } from "~/domain/mail/reservation-message-mail";
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
  type Reservation,
  type ReservationRepository,
} from "~/domain/reservation";
import type {
  CreateReservationMessageOutcome,
  ReservationMessage,
  ReservationMessageRepository,
} from "~/domain/reservation/message";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { ReservationMailRecipientsQuery } from "~/query/reservation/reservation-mail-recipients";
import {
  sendReservationMessageUseCase,
  type SendReservationMessageArgs,
  type SendReservationMessageDeps,
} from "./send-reservation-message";

const sampleReservation: Reservation = {
  id: "res_target",
  groupId: "grp_robotics",
  facilityId: "fac_meeting_a",
  startAt: new Date("2026-10-10T10:00:00+09:00"),
  endAt: new Date("2026-10-10T12:00:00+09:00"),
  headCount: 4,
  note: null,
  status: ReservationStatus.Approved,
  statusReason: null,
  createdBy: "usr_applicant",
  createdAt: new Date("2026-10-01T10:00:00+09:00"),
  updatedAt: new Date("2026-10-01T10:00:00+09:00"),
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
  userId: "usr_staff1",
  address: "staff1@osaka-u.ac.jp",
  name: "事務局員1",
};
const userStaff2 = {
  userId: "usr_staff2",
  address: "staff2@osaka-u.ac.jp",
  name: "事務局員2",
};

const defaultAudience: ReservationMessageAudience = {
  groupMembers: [userApplicant, userAdmin],
  staff: [userStaff1, userStaff2],
  priorGroupSideSenders: [userPriorSender],
};

const createDeps = (
  overrides: {
    reservation?: Reservation | null;
    reservationError?: boolean;
    membership?: Membership | null;
    membershipError?: boolean;
    audience?: ReservationMessageAudience;
    recipientsQueryError?: QueryError;
    messageCreateError?: boolean;
    enqueuedMailIds?: readonly string[];
  } = {},
) => {
  const applyStatusTransition = vi.fn();
  const applyContentEdit = vi.fn();
  const createReservation = vi.fn();
  const createApproved = vi.fn();

  const reservationRepository: ReservationRepository = {
    findById: vi.fn((_id: string) => {
      if (overrides.reservationError) {
        return errAsync({
          code: ReservationErrorCode.DatabaseError,
          message: "DB error",
        });
      }
      if (overrides.reservation === null) {
        return errAsync({
          code: ReservationErrorCode.NotFound,
          message: "Reservation not found",
        });
      }
      return okAsync(overrides.reservation ?? sampleReservation);
    }),
    create: createReservation,
    createApproved,
    existsApprovedOverlap: vi.fn(() => okAsync(false)),
    applyStatusTransition,
    applyContentEdit,
  };

  const findByGroupAndUser = vi.fn((_groupId: string, _userId: string) => {
    if (overrides.membershipError) {
      return errAsync({
        code: MembershipErrorCode.DatabaseError,
        message: "Membership DB error",
      });
    }
    return okAsync(
      overrides.membership !== undefined
        ? overrides.membership
        : {
            groupId: "grp_robotics",
            userId: "usr_member",
            role: MembershipRole.Member,
          },
    );
  });

  const membershipRepository: MembershipRepository = {
    findByGroupAndUser,
    countAdmins: vi.fn(() => okAsync(1)),
    updateRole: vi.fn(),
    remove: vi.fn(),
  };

  const createMessage = vi.fn((_message: ReservationMessage, _mails: readonly MailDraft[]) => {
    if (overrides.messageCreateError) {
      return errAsync({
        code: ReservationErrorCode.DatabaseError,
        message: "Message create failed",
      });
    }
    return okAsync<CreateReservationMessageOutcome, never>({
      enqueuedMailIds: overrides.enqueuedMailIds ?? ["mail_msg_01"],
    });
  });

  const reservationMessageRepository: ReservationMessageRepository = {
    create: createMessage,
  };

  const findForMessage = vi.fn((_reservationId: string) => {
    if (overrides.recipientsQueryError) {
      return errAsync(overrides.recipientsQueryError);
    }
    return okAsync(overrides.audience ?? defaultAudience);
  });

  const reservationMailRecipientsQuery: ReservationMailRecipientsQuery = {
    findByReservationId: vi.fn(),
    findForNewReservation: vi.fn(),
    findForMessage,
  };

  const notifyEnqueued = vi.fn((_outboxIds: readonly string[]) => {});

  const deps: SendReservationMessageDeps = {
    reservationRepository,
    membershipRepository,
    reservationMessageRepository,
    reservationMailRecipientsQuery,
    mailOutboxNotifier: { notifyEnqueued },
  };

  return {
    deps,
    createMessage,
    findForMessage,
    findByGroupAndUser,
    notifyEnqueued,
    applyStatusTransition,
    applyContentEdit,
    createReservation,
  };
};

const defaultArgs: SendReservationMessageArgs = {
  reservationId: "res_target",
  actorUserId: "usr_member",
  actorName: "一般メンバー",
  isStaff: false,
  body: "予約に関する確認事項です。",
  now: new Date("2026-10-05T14:00:00+09:00"),
  appBaseUrl: "https://example.com",
};

describe("sendReservationMessageUseCase", () => {
  it("一般メンバー（管理者でない）が送る場合、sentAsStaff: false で保存され、宛先は事務局のみ、送信者本人に届かず、配送依頼が呼ばれて messageId が返る", async () => {
    const { deps, createMessage, findForMessage, notifyEnqueued } = createDeps({
      membership: {
        groupId: "grp_robotics",
        userId: "usr_member",
        role: MembershipRole.Member,
      },
    });

    const result = await sendReservationMessageUseCase(deps, defaultArgs);

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.messageId).toBeDefined();

    expect(findForMessage).toHaveBeenCalledWith("res_target");
    expect(createMessage).toHaveBeenCalledTimes(1);
    const [savedMessage, savedMails] = createMessage.mock.calls[0]!;

    expect(savedMessage).toMatchObject({
      id: value.messageId,
      reservationId: "res_target",
      senderId: "usr_member",
      sentAsStaff: false,
      body: "予約に関する確認事項です。",
      sentAt: defaultArgs.now,
    });

    // 宛先は事務局（userStaff1, userStaff2）のみ
    expect(savedMails).toHaveLength(2);
    expect(savedMails.map((m) => m.to.address)).toEqual([userStaff1.address, userStaff2.address]);

    expect(notifyEnqueued).toHaveBeenCalledWith(["mail_msg_01"]);
  });

  it("団体管理者が送る場合も sentAsStaff: false で保存され、宛先は事務局のみとなる", async () => {
    const { deps, createMessage } = createDeps({
      membership: {
        groupId: "grp_robotics",
        userId: "usr_admin",
        role: MembershipRole.Admin,
      },
    });

    const result = await sendReservationMessageUseCase(deps, {
      ...defaultArgs,
      actorUserId: "usr_admin",
      actorName: "団体管理者",
    });

    expect(result.isOk()).toBe(true);
    const [savedMessage, savedMails] = createMessage.mock.calls[0]!;
    expect(savedMessage.sentAsStaff).toBe(false);
    expect(savedMails.map((m) => m.to.address)).toEqual([userStaff1.address, userStaff2.address]);
  });

  it("その団体に所属しない事務局が送る場合、sentAsStaff: true となり、宛先は申請者・管理者・過去の団体側送信者となり、所属も引いている", async () => {
    const { deps, createMessage, findByGroupAndUser } = createDeps({
      membership: null, // その団体に所属していない
    });

    const result = await sendReservationMessageUseCase(deps, {
      ...defaultArgs,
      actorUserId: "usr_staff1",
      actorName: "事務局員1",
      isStaff: true,
    });

    expect(result.isOk()).toBe(true);
    expect(findByGroupAndUser).toHaveBeenCalledWith("grp_robotics", "usr_staff1");

    const [savedMessage, savedMails] = createMessage.mock.calls[0]!;
    expect(savedMessage.sentAsStaff).toBe(true);

    // 宛先は申請者・管理者・過去送信者の和（userApplicant, userAdmin, userPriorSender）
    expect(savedMails.map((m) => m.to.address)).toEqual([
      userAdmin.address,
      userApplicant.address,
      userPriorSender.address,
    ]);
  });

  it("その団体に所属する事務局が送る場合、sentAsStaff: false となり、宛先は（自分を除く）事務局となる", async () => {
    const { deps, createMessage } = createDeps({
      membership: {
        groupId: "grp_robotics",
        userId: "usr_staff1",
        role: MembershipRole.Member,
      },
    });

    const result = await sendReservationMessageUseCase(deps, {
      ...defaultArgs,
      actorUserId: "usr_staff1",
      actorName: "事務局兼メンバー",
      isStaff: true,
    });

    expect(result.isOk()).toBe(true);
    const [savedMessage, savedMails] = createMessage.mock.calls[0]!;
    expect(savedMessage.sentAsStaff).toBe(false);

    // 宛先は事務局のうち自分 (usr_staff1) を除く userStaff2 のみ
    expect(savedMails).toHaveLength(1);
    expect(savedMails[0]!.to.address).toBe(userStaff2.address);
  });

  it("他団体のユーザーが送ろうとした場合、Forbidden となり「この予約にはメッセージを送れません。」が返り、保存もメールも行われない", async () => {
    const { deps, createMessage } = createDeps({
      membership: null, // 所属なし
    });

    const result = await sendReservationMessageUseCase(deps, {
      ...defaultArgs,
      actorUserId: "usr_other",
      isStaff: false,
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(ReservationErrorCode.Forbidden);
    expect(error.userMessage).toBe("この予約にはメッセージを送れません。");
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("他団体のユーザーの場合、本文が空であっても Forbidden が先に返る（権限チェックが先）", async () => {
    const { deps, createMessage } = createDeps({
      membership: null,
    });

    const result = await sendReservationMessageUseCase(deps, {
      ...defaultArgs,
      actorUserId: "usr_other",
      isStaff: false,
      body: "", // 本文が空
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(ReservationErrorCode.Forbidden);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("本文の検証が失敗した場合は InvalidInput となり保存されず、成功した場合は正規化後の値で保存される", async () => {
    const { deps, createMessage } = createDeps();

    // 空本文のエラー
    const emptyResult = await sendReservationMessageUseCase(deps, {
      ...defaultArgs,
      body: "   \n  \u3000 ",
    });
    expect(emptyResult.isErr()).toBe(true);
    expect(emptyResult._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.InvalidInput,
      field: ReservationField.MessageBody,
      userMessage: "メッセージを入力してください。",
    });
    expect(createMessage).not.toHaveBeenCalled();

    // 正規化されて保存されるケース
    const rawBody = "　\r\n  行1\r\n行2  \r\n　";
    const okResult = await sendReservationMessageUseCase(deps, {
      ...defaultArgs,
      body: rawBody,
    });
    expect(okResult.isOk()).toBe(true);
    const [savedMessage] = createMessage.mock.calls[0]!;
    expect(savedMessage.body).toBe("行1\n行2");
  });

  it("却下・キャンセル済み・過去の予約であってもメッセージを送信できる（状態や日時を問わない）", async () => {
    const rejectedPastReservation: Reservation = {
      ...sampleReservation,
      status: ReservationStatus.Rejected,
      statusReason: "理由あり",
      startAt: new Date("2026-08-01T10:00:00+09:00"),
      endAt: new Date("2026-08-01T12:00:00+09:00"),
    };
    const { deps, createMessage } = createDeps({
      reservation: rejectedPastReservation,
    });

    const result = await sendReservationMessageUseCase(deps, defaultArgs);

    expect(result.isOk()).toBe(true);
    expect(createMessage).toHaveBeenCalledTimes(1);
  });

  it("予約が存在しない場合は NotFound を返す", async () => {
    const { deps, createMessage } = createDeps({
      reservation: null,
    });

    const result = await sendReservationMessageUseCase(deps, defaultArgs);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.NotFound);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("所属の読み取りが失敗した場合は DatabaseError を返す", async () => {
    const { deps, createMessage } = createDeps({
      membershipError: true,
    });

    const result = await sendReservationMessageUseCase(deps, defaultArgs);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.DatabaseError);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("宛先の読み取りが失敗した場合は DatabaseError となりメッセージを保存しない", async () => {
    const { deps, createMessage } = createDeps({
      recipientsQueryError: {
        code: QueryErrorCode.DatabaseError,
        message: "Failed to fetch recipients",
      },
    });

    const result = await sendReservationMessageUseCase(deps, defaultArgs);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.DatabaseError);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("メッセージの保存が失敗した場合はエラーを返し、requestImmediateDelivery を呼ばない", async () => {
    const { deps, notifyEnqueued } = createDeps({
      messageCreateError: true,
    });

    const result = await sendReservationMessageUseCase(deps, defaultArgs);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.DatabaseError);
    expect(notifyEnqueued).not.toHaveBeenCalled();
  });

  it("予約リポジトリの更新系メソッド（applyStatusTransition 等）を一度も呼ばない", async () => {
    const { deps, applyStatusTransition, applyContentEdit, createReservation } = createDeps();

    const result = await sendReservationMessageUseCase(deps, defaultArgs);

    expect(result.isOk()).toBe(true);
    expect(applyStatusTransition).not.toHaveBeenCalled();
    expect(applyContentEdit).not.toHaveBeenCalled();
    expect(createReservation).not.toHaveBeenCalled();
  });
});
