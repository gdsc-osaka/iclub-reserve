import { groupStatusLabel } from "~/components/group/group-status-badge";
import { reservationStatusLabel } from "~/components/reservation/reservation-status-badge";
import { AuditLogTargetType, type AuditLogChanges, type AuditLogValue } from "~/domain/audit-log";
import { invitationStatusLabel } from "~/domain/invitation";
import { membershipRoleLabel } from "~/domain/membership";
import { formatDateTime } from "~/lib/date";

/**
 * 変更内容の各項目の日本語ラベル定義。
 *
 * 表に定義されていないキーはキー名をそのままフォールバックして表示する。
 */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  facility_id: "施設/設備",
  start_at: "開始日時",
  end_at: "終了日時",
  head_count: "使用人数",
  note: "備考",
  status: "状態",
  status_reason: "理由",
  name: "名称",
  role: "役割",
  user_id: "ユーザー",
  email: "メールアドレス",
  description: "説明",
  photo_url: "写真",
  google_calendar_id: "Google カレンダー ID",
  calendar_url: "カレンダー URL",
  is_active: "有効/無効",
  is_staff: "事務局権限",
  staff_invitation_id: "事務局招待",
};

export interface FormatChangesOptions {
  readonly targetType: AuditLogTargetType;
  readonly userNames?: Readonly<Record<string, string>>;
  readonly facilityNames?: Readonly<Record<string, string>>;
}

export interface FormattedChange {
  readonly key: string;
  readonly label: string;
  readonly displayText: string;
}

/**
 * 1 つの値を画面表示用にフォーマットする。
 */
export const formatChangeValue = (
  key: string,
  value: AuditLogValue,
  options: FormatChangesOptions,
): string => {
  if (value === null) {
    return "（なし）";
  }

  // 日時 (*_at)
  if (key.endsWith("_at")) {
    if (typeof value === "string") {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return formatDateTime(date);
      }
    }
    return String(value);
  }

  // 状態 (status)
  if (key === "status" && typeof value === "string") {
    if (options.targetType === AuditLogTargetType.Reservation) {
      return reservationStatusLabel[value as keyof typeof reservationStatusLabel] ?? value;
    }
    if (options.targetType === AuditLogTargetType.Group) {
      return groupStatusLabel[value as keyof typeof groupStatusLabel] ?? value;
    }
    if (
      options.targetType === AuditLogTargetType.Invitation ||
      options.targetType === AuditLogTargetType.StaffRole
    ) {
      return invitationStatusLabel[value as keyof typeof invitationStatusLabel] ?? value;
    }
    return value;
  }

  // 役割 (role)
  if (key === "role" && typeof value === "string") {
    return membershipRoleLabel[value as keyof typeof membershipRoleLabel] ?? value;
  }

  // 有効/無効 (is_active)
  if (key === "is_active") {
    return value === true ? "有効" : "無効";
  }

  // 事務局権限 (is_staff)
  if (key === "is_staff") {
    return value === true ? "あり" : "なし";
  }

  // 写真 (photo_url)
  if (key === "photo_url") {
    return value ? "あり" : "なし";
  }

  // ユーザー ID (user_id)
  if (key === "user_id" && typeof value === "string") {
    return options.userNames?.[value] ?? "（不明）";
  }

  // 施設 ID (facility_id)
  if (key === "facility_id" && typeof value === "string") {
    return options.facilityNames?.[value] ?? "（不明）";
  }

  return String(value);
};

/**
 * 1 項目の変更前後の差分をテキスト表現にする。
 *
 * - before と after が同じ → 項目名: 値
 * - before が null → 項目名: 新
 * - それ以外 → 項目名: 旧 → 新（null は「（なし）」）
 */
export const formatSingleChangeText = (
  key: string,
  before: AuditLogValue,
  after: AuditLogValue,
  options: FormatChangesOptions,
): string => {
  const label = FIELD_LABELS[key] ?? key;

  // 変わっていない項目（対象を特定するための値）と、作成で新しくできた項目は、新しい値だけを出す
  if (before === after || before === null) {
    return `${label}: ${formatChangeValue(key, after, options)}`;
  }

  const beforeText = formatChangeValue(key, before, options);
  const afterText = formatChangeValue(key, after, options);
  return `${label}: ${beforeText} → ${afterText}`;
};

/**
 * 変更内容（AuditLogChanges）全体を整形した項目の配列に変換する。
 */
export const formatChanges = (
  changes: AuditLogChanges,
  options: FormatChangesOptions,
): readonly FormattedChange[] => {
  return Object.entries(changes).map(([key, fieldChange]) => {
    const label = FIELD_LABELS[key] ?? key;
    const displayText = formatSingleChangeText(key, fieldChange.before, fieldChange.after, options);
    return {
      key,
      label,
      displayText,
    };
  });
};
