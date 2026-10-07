/**
 * 操作履歴（INFO-008 / BIZ-007）のドメイン定義。
 *
 * 予約・団体・メンバーシップ・招待・施設・事務局権限に対して人が行った操作を追記する（COND-013）。
 * 記録は無期限に保持され、編集・削除する操作は用意しない（REQ-038）。
 */

/**
 * 記録対象の種類（VAR-003）。
 *
 * NOTE: 値は保存済みの記録に残るので変えない。
 */
export const AuditLogTargetType = {
  Reservation: "reservation",
  Group: "group",
  Membership: "membership",
  Invitation: "invitation",
  Facility: "facility",
  StaffRole: "staff_role",
} as const;
export type AuditLogTargetType = (typeof AuditLogTargetType)[keyof typeof AuditLogTargetType];

/**
 * 記録対象の種類の表示名。
 */
export const auditLogTargetTypeLabel: Record<AuditLogTargetType, string> = {
  [AuditLogTargetType.Reservation]: "予約",
  [AuditLogTargetType.Group]: "団体",
  [AuditLogTargetType.Membership]: "メンバーシップ",
  [AuditLogTargetType.Invitation]: "招待",
  [AuditLogTargetType.Facility]: "施設/設備",
  [AuditLogTargetType.StaffRole]: "事務局権限",
};

/**
 * 操作の種類（VAR-002）。
 *
 * NOTE: 値は保存済みの記録に残るので変えない。
 */
export const AuditLogAction = {
  // 予約（BIZ-001 / BIZ-002）
  ReservationApply: "reservation.apply",
  ReservationEditProvisional: "reservation.edit_provisional",
  ReservationWithdraw: "reservation.withdraw",
  ReservationCancel: "reservation.cancel",
  ReservationChange: "reservation.change",
  ReservationApprove: "reservation.approve",
  ReservationReject: "reservation.reject",
  ReservationStaffCancel: "reservation.staff_cancel",
  ReservationDirectCreate: "reservation.direct_create",
  ReservationDirectChange: "reservation.direct_change",

  // 団体（BIZ-003）
  GroupCreate: "group.create",
  GroupUpdate: "group.update",
  GroupEnable: "group.enable",
  GroupDisable: "group.disable",

  // メンバーシップ（BIZ-003）
  MembershipChangeRole: "membership.change_role",
  MembershipRemove: "membership.remove",

  // 招待（BIZ-003）
  InvitationSend: "invitation.send",
  InvitationCancel: "invitation.cancel",
  InvitationAccept: "invitation.accept",
  InvitationDecline: "invitation.decline",

  // 施設/設備（BIZ-004）
  FacilityCreate: "facility.create",
  FacilityUpdate: "facility.update",
  FacilityDeactivate: "facility.deactivate",
  FacilityReactivate: "facility.reactivate",

  // 事務局権限（BIZ-006）
  StaffRoleInvite: "staff_role.invite",
  StaffRoleCancelInvitation: "staff_role.cancel_invitation",
  StaffRoleAccept: "staff_role.accept",
  StaffRoleDecline: "staff_role.decline",
  StaffRoleRevoke: "staff_role.revoke",
} as const;
export type AuditLogAction = (typeof AuditLogAction)[keyof typeof AuditLogAction];

/**
 * 操作の種類の表示名。
 */
export const auditLogActionLabel: Record<AuditLogAction, string> = {
  [AuditLogAction.ReservationApply]: "申請",
  [AuditLogAction.ReservationEditProvisional]: "仮予約の編集",
  [AuditLogAction.ReservationWithdraw]: "取り消し",
  [AuditLogAction.ReservationCancel]: "キャンセル",
  [AuditLogAction.ReservationChange]: "内容変更",
  [AuditLogAction.ReservationApprove]: "承認",
  [AuditLogAction.ReservationReject]: "却下",
  [AuditLogAction.ReservationStaffCancel]: "事務局キャンセル",
  [AuditLogAction.ReservationDirectCreate]: "直接作成",
  [AuditLogAction.ReservationDirectChange]: "直接変更",

  [AuditLogAction.GroupCreate]: "作成",
  [AuditLogAction.GroupUpdate]: "団体情報の編集",
  [AuditLogAction.GroupEnable]: "有効化",
  [AuditLogAction.GroupDisable]: "無効化",

  [AuditLogAction.MembershipChangeRole]: "ロールの変更",
  [AuditLogAction.MembershipRemove]: "削除",

  [AuditLogAction.InvitationSend]: "送信",
  [AuditLogAction.InvitationCancel]: "取り消し",
  [AuditLogAction.InvitationAccept]: "承諾",
  [AuditLogAction.InvitationDecline]: "辞退",

  [AuditLogAction.FacilityCreate]: "登録",
  [AuditLogAction.FacilityUpdate]: "編集",
  [AuditLogAction.FacilityDeactivate]: "無効化",
  [AuditLogAction.FacilityReactivate]: "再有効化",

  [AuditLogAction.StaffRoleInvite]: "招待",
  [AuditLogAction.StaffRoleCancelInvitation]: "招待の取り消し",
  [AuditLogAction.StaffRoleAccept]: "承諾",
  [AuditLogAction.StaffRoleDecline]: "辞退",
  [AuditLogAction.StaffRoleRevoke]: "剥奪",
};

/**
 * 操作から記録対象の種類を導く対応表。
 *
 * 接頭辞から機械的に導かず、表として明示することで
 * 操作と対象の結びつきの不整合を防ぐ。
 */
export const auditLogActionTargetType: Record<AuditLogAction, AuditLogTargetType> = {
  [AuditLogAction.ReservationApply]: AuditLogTargetType.Reservation,
  [AuditLogAction.ReservationEditProvisional]: AuditLogTargetType.Reservation,
  [AuditLogAction.ReservationWithdraw]: AuditLogTargetType.Reservation,
  [AuditLogAction.ReservationCancel]: AuditLogTargetType.Reservation,
  [AuditLogAction.ReservationChange]: AuditLogTargetType.Reservation,
  [AuditLogAction.ReservationApprove]: AuditLogTargetType.Reservation,
  [AuditLogAction.ReservationReject]: AuditLogTargetType.Reservation,
  [AuditLogAction.ReservationStaffCancel]: AuditLogTargetType.Reservation,
  [AuditLogAction.ReservationDirectCreate]: AuditLogTargetType.Reservation,
  [AuditLogAction.ReservationDirectChange]: AuditLogTargetType.Reservation,

  [AuditLogAction.GroupCreate]: AuditLogTargetType.Group,
  [AuditLogAction.GroupUpdate]: AuditLogTargetType.Group,
  [AuditLogAction.GroupEnable]: AuditLogTargetType.Group,
  [AuditLogAction.GroupDisable]: AuditLogTargetType.Group,

  [AuditLogAction.MembershipChangeRole]: AuditLogTargetType.Membership,
  [AuditLogAction.MembershipRemove]: AuditLogTargetType.Membership,

  [AuditLogAction.InvitationSend]: AuditLogTargetType.Invitation,
  [AuditLogAction.InvitationCancel]: AuditLogTargetType.Invitation,
  [AuditLogAction.InvitationAccept]: AuditLogTargetType.Invitation,
  [AuditLogAction.InvitationDecline]: AuditLogTargetType.Invitation,

  [AuditLogAction.FacilityCreate]: AuditLogTargetType.Facility,
  [AuditLogAction.FacilityUpdate]: AuditLogTargetType.Facility,
  [AuditLogAction.FacilityDeactivate]: AuditLogTargetType.Facility,
  [AuditLogAction.FacilityReactivate]: AuditLogTargetType.Facility,

  [AuditLogAction.StaffRoleInvite]: AuditLogTargetType.StaffRole,
  [AuditLogAction.StaffRoleCancelInvitation]: AuditLogTargetType.StaffRole,
  [AuditLogAction.StaffRoleAccept]: AuditLogTargetType.StaffRole,
  [AuditLogAction.StaffRoleDecline]: AuditLogTargetType.StaffRole,
  [AuditLogAction.StaffRoleRevoke]: AuditLogTargetType.StaffRole,
};

/**
 * 文字列を対象の種類にパースする（URL クエリ等の検証用）。
 */
export const parseAuditLogTargetType = (value: unknown): AuditLogTargetType | null => {
  if (typeof value !== "string") return null;
  const targetTypes = Object.values(AuditLogTargetType) as readonly string[];
  return targetTypes.includes(value) ? (value as AuditLogTargetType) : null;
};

/**
 * 記録に残す値（INFO-008.changes）。
 *
 * 日時は ISO 8601（UTC）の文字列で残す。
 */
export type AuditLogValue = string | number | boolean | null;

/**
 * 1 項目の変更前と変更後。
 *
 * - 作成は before が null、削除は after が null。
 * - 対象を特定する項目（メンバーシップの user_id、招待の email と role など）は、
 *   値が変わらなくても before と after に同じ値を入れて残す。
 * - 状態の変更では理由を status_reason として含める。
 */
export interface AuditLogFieldChange {
  readonly before: AuditLogValue;
  readonly after: AuditLogValue;
}

/**
 * 変更内容。
 *
 * キーは INFO の属性名（スネークケース。例: head_count, status_reason, user_id）。
 */
export type AuditLogChanges = Readonly<Record<string, AuditLogFieldChange>>;

const isAuditLogValue = (value: unknown): value is AuditLogValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

/**
 * DB から取得した変更内容を安全にパースする。
 *
 * DB から来る値は信用せず、形の合わない項目は捨てて残りを返す。
 * オブジェクトでなければ空のオブジェクトを返し、例外は投げない。
 */
export const parseAuditLogChanges = (value: unknown): AuditLogChanges => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, AuditLogFieldChange> = {};
  for (const [key, fieldChange] of Object.entries(value)) {
    if (
      typeof fieldChange === "object" &&
      fieldChange !== null &&
      !Array.isArray(fieldChange) &&
      "before" in fieldChange &&
      "after" in fieldChange
    ) {
      const { before, after } = fieldChange as { before: unknown; after: unknown };
      if (isAuditLogValue(before) && isAuditLogValue(after)) {
        result[key] = { before, after };
      }
    }
  }

  return result;
};

/** 画面に渡す操作者。団体側に伏せるときは名前を持たない形にする（COND-012） */
export type AuditLogActorView =
  | { readonly kind: "staff" } // 「事務局」とだけ出す
  | { readonly kind: "person"; readonly name: string | null; readonly actedAsStaff: boolean };

/**
 * 記録の操作者を見る人に応じて詰め替える純粋関数（COND-012）。
 *
 * 事務局権限による操作（actedAsStaff: true）を事務局以外の利用者（自団体の管理者など）が
 * 閲覧する場合、操作者の個人名や ID を伏せて「事務局」として表示する。
 * 事務局員本人が見る場合は、誰が行った操作かを把握できるよう個人名を表示する。
 */
export const toAuditLogActorView = (
  record: { readonly actorName: string | null; readonly actedAsStaff: boolean },
  viewer: { readonly isStaff: boolean },
): AuditLogActorView => {
  if (record.actedAsStaff && !viewer.isStaff) {
    return { kind: "staff" };
  }
  return {
    kind: "person",
    name: record.actorName,
    actedAsStaff: record.actedAsStaff,
  };
};

/** 画面に渡す 1 件の操作履歴情報 */
export interface AuditLogEntryView {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actor: AuditLogActorView;
  readonly action: AuditLogAction;
  readonly targetType: AuditLogTargetType;
  readonly targetId: string;
  readonly changes: AuditLogChanges;
}

/**
 * 操作履歴の 1 件を画面用の型に詰め替える純粋関数（COND-012）。
 *
 * 事務局権限による操作（actedAsStaff: true）は、事務局以外の利用者に対して
 * 操作者情報を伏せて「事務局」として返す。
 */
export const toAuditLogEntryView = (
  record: {
    readonly id: string;
    readonly occurredAt: Date;
    readonly actorName: string | null;
    readonly actedAsStaff: boolean;
    readonly action: AuditLogAction;
    readonly targetType: AuditLogTargetType;
    readonly targetId: string;
    readonly changes: AuditLogChanges;
  },
  viewer: { readonly isStaff: boolean },
): AuditLogEntryView => ({
  id: record.id,
  occurredAt: record.occurredAt,
  actor: toAuditLogActorView(record, viewer),
  action: record.action,
  targetType: record.targetType,
  targetId: record.targetId,
  changes: record.changes,
});
