import type { Result, ResultAsync } from "neverthrow";
import type { PermissionTable } from "../authz";
import { ErrorKind, type BaseError } from "../error";
import type { InvitationStatus } from "../invitation";
import { validateInviteeEmail } from "../invitation/invitation-email";
import type { MailDraft } from "../mail/mail-outbox";
import { StaffRole } from "../membership";

/**
 * 事務局管理まわりのエラーコード。
 *
 * 列挙子の名前は型名を繰り返さないが、文字列の値は変えないこと（ADR-004 決定 1）。
 */
export const StaffErrorCode = {
  Forbidden: "STAFF_FORBIDDEN",
  InvalidInput: "STAFF_INVALID_INPUT",
  InvitationNotFound: "STAFF_INVITATION_NOT_FOUND",
  MemberNotFound: "STAFF_MEMBER_NOT_FOUND",
  LastStaffRequired: "STAFF_LAST_STAFF_REQUIRED",
  Conflict: "STAFF_CONFLICT",
  DatabaseError: "DATABASE_ERROR",
} as const;
export type StaffErrorCode = (typeof StaffErrorCode)[keyof typeof StaffErrorCode];

/**
 * 事務局管理まわりのエラーコードの分類（ADR-004 決定 3）。
 *
 * HTTP の status とログのレベルは、この表から決まる。
 */
export const staffErrorKind: Record<StaffErrorCode, ErrorKind> = {
  [StaffErrorCode.Forbidden]: ErrorKind.Forbidden,
  [StaffErrorCode.InvalidInput]: ErrorKind.InvalidInput,
  [StaffErrorCode.InvitationNotFound]: ErrorKind.NotFound,
  [StaffErrorCode.MemberNotFound]: ErrorKind.NotFound,
  [StaffErrorCode.LastStaffRequired]: ErrorKind.Conflict,
  [StaffErrorCode.Conflict]: ErrorKind.Conflict,
  [StaffErrorCode.DatabaseError]: ErrorKind.Internal,
};

/** どの入力項目についての誤りか（ADR-004 決定 4） */
export const StaffField = {
  Email: "email",
} as const;
export type StaffField = (typeof StaffField)[keyof typeof StaffField];

/**
 * 事務局管理に関するドメインエラー。
 */
export interface StaffError extends BaseError {
  readonly code: StaffErrorCode;
  readonly field?: StaffField;
}

/**
 * 事務局管理に対して行える操作。
 */
export const StaffAction = {
  ViewManagement: "view_management",
  Invite: "invite",
  CancelInvitation: "cancel_invitation",
  Revoke: "revoke",
} as const;
export type StaffAction = (typeof StaffAction)[keyof typeof StaffAction];

/**
 * 事務局管理に関する権限の表（COND-009）。
 *
 * すべての操作を事務局（StaffRole）だけに許可する。
 */
export const staffPermissions: PermissionTable<typeof StaffRole, StaffAction> = {
  base: [],
  byRole: {
    [StaffRole]: [
      StaffAction.ViewManagement,
      StaffAction.Invite,
      StaffAction.CancelInvitation,
      StaffAction.Revoke,
    ],
  },
};

/**
 * 事務局招待を表すドメインモデル（INFO-009）。
 */
export interface StaffInvitation {
  readonly id: string;
  readonly email: string;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
  readonly inviterId: string;
  readonly createdAt: Date;
}

/**
 * 事務局招待の新規作成に必要な入力。
 */
export interface CreateStaffInvitationInput {
  readonly id: string;
  readonly email: string;
  readonly expiresAt: Date;
  readonly inviterId: string;
  readonly createdAt: Date;
}

/**
 * 事務局招待作成の実行結果。
 */
export interface CreateStaffInvitationOutcome {
  readonly enqueuedMailIds: readonly string[];
}

/**
 * 操作の実行後に、事務局が居なくなってしまうかを判定する純粋関数（COND-014）。
 *
 * 剥奪した後に事務局が 1 人以上残るなら false、0 人になるなら true を返す。
 */
export const wouldRemoveLastStaff = (staffCount: number): boolean => staffCount - 1 < 1;

/**
 * 事務局招待の承諾画面（SCR-020）のパスを返す。
 *
 * SCR-020 は未実装。招待される人はまだ事務局ではないため、/staff/ の下には置かない。
 */
export const staffInvitationAcceptPath = (invitationId: string): string =>
  `/staff-invitations/${invitationId}`;

/**
 * 事務局招待先メールアドレスの入力を検証・正規化する純粋関数。
 *
 * 共通の検証処理（`validateInviteeEmail`）を通し、StaffError に詰め替えて返す。
 */
export const validateStaffInvitationEmail = (
  raw: string | null | undefined,
): Result<string, StaffError> =>
  validateInviteeEmail(raw).mapErr((problem) => ({
    code: StaffErrorCode.InvalidInput,
    field: StaffField.Email,
    message: problem.message,
    userMessage: problem.userMessage,
  }));

/**
 * 事務局招待の永続化層に対する窓口（ポート）。
 */
export interface StaffInvitationRepository {
  /** 宛先（正規化済み）の承諾待ちの招待のうち、expires_at が最も遅いもの。無ければ null。期限切れも返す（判定はユースケース） */
  findPendingByEmail(email: string): ResultAsync<StaffInvitation | null, StaffError>;
  /** 招待の INSERT と outbox の INSERT を同じ db.batch で行う（ADR-002 決定 3） */
  create(
    input: CreateStaffInvitationInput,
    mailDrafts: readonly MailDraft[],
  ): ResultAsync<CreateStaffInvitationOutcome, StaffError>;
  /** status = pending のものだけを canceled にする。更新した件数を返す */
  cancel(invitationId: string): ResultAsync<number, StaffError>;
}

/**
 * 事務局メンバーの永続化層に対する窓口（ポート）。
 */
export interface StaffMemberRepository {
  /** lower(email) が一致し、is_staff = 1 のユーザー。無ければ null */
  findStaffByEmail(
    normalizedEmail: string,
  ): ResultAsync<{ readonly id: string } | null, StaffError>;
  /** id が一致し、is_staff = 1 のユーザー。無ければ null */
  findStaffById(userId: string): ResultAsync<{ readonly id: string } | null, StaffError>;
  countStaff(): ResultAsync<number, StaffError>;
  /**
   * is_staff を false にし、updated_at を now にする。COND-014 を更新文の条件にも入れる:
   * WHERE id = ? AND is_staff = 1 AND (SELECT COUNT(*) FROM user WHERE is_staff = 1) >= 2
   * 更新した件数を返す
   */
  revoke(userId: string, now: Date): ResultAsync<number, StaffError>;
}
