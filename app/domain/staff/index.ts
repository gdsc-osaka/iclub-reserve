import type { Result, ResultAsync } from "neverthrow";
import type { PermissionTable } from "../authz";
import { ErrorKind, type BaseError } from "../error";
import type { InvitationStatus, RejectInvitationInput } from "../invitation";
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
  /**
   * 招待はあるが、宛先が本人ではないので見せない。
   *
   * 利用者には `InvitationNotFound` と同じ応答を返す（COND-015）。宛先が違うと答えると、
   * 招待 ID を知っている人に「この招待は実在する」と伝わってしまう。
   * ユースケースが `InvitationNotFound` に潰さずに正直に返すのは、他人宛ての招待を開こうとしたことを
   * サーバーのログに権限の問題として残したいため。秘匿は画面の側が行う（ADR-004 決定 4）。
   */
  InvitationNotVisible: "STAFF_INVITATION_NOT_VISIBLE",
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
  [StaffErrorCode.InvitationNotVisible]: ErrorKind.Forbidden,
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
 * `app/routes/staff-invitations/$invitationId/route.tsx` で実装されている。
 * 招待される人はまだ事務局ではないため、/staff/ の下には置かない。
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
 * 事務局招待の承諾に必要な値。
 */
export interface AcceptStaffInvitationInput {
  readonly invitationId: string;
  /**
   * 承諾しようとしている人のメールアドレス（`normalizeInvitationEmail` を通したもの）。
   */
  readonly email: string;
  /** 承諾する人の `user.id`。`user.is_staff` を true にする対象 */
  readonly userId: string;
  /** 有効期限を判定する基準時刻 */
  readonly now: Date;
}

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
  /**
   * 招待を 1 件引く。無ければ ok(null)。
   *
   * 承諾できる状態かどうか（期限・状態・宛先）はここでは見ない。
   * それを判定するための材料を返すのがこのメソッドの役目で、
   * 判定の基準となる「いま」とログイン中の人を知っているのはユースケースだから。
   */
  findById(invitationId: string): ResultAsync<StaffInvitation | null, StaffError>;
  /**
   * 招待を承諾し、承諾できた場合は true、できなければ false を返す。
   *
   * 「承諾できる招待か」の判定（承諾待ち・期限内・宛先が本人）は UPDATE の WHERE に畳み込む。
   * false は「対象の招待が無かった」ということであり、DB アクセス自体の異常ではない。
   */
  accept(input: AcceptStaffInvitationInput): ResultAsync<boolean, StaffError>;
  /**
   * 招待を辞退し、辞退できた行数を返す。
   *
   * 判定の条件は `accept` とそろえる。
   */
  reject(input: RejectInvitationInput): ResultAsync<number, StaffError>;
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
