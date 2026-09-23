import type { ResultAsync } from "neverthrow";
import type { PermissionTable } from "../authz";
import { ErrorKind, type BaseError } from "../error";
import { StaffRole } from "../membership";

export interface Facility {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  description: string | null;
  photoUrl: string | null;
  googleCalendarId: string | null;
  calendarUrl: string | null;
}

/**
 * 施設まわりのエラーコード。
 *
 * 列挙子の名前は型名を繰り返さないが、文字列の値は変えないこと（ADR-004 決定 1）。
 * ログに出るのは値の方なので、変えると過去のログと突き合わせられなくなる。
 */
export const FacilityErrorCode = {
  /** 施設・設備が存在しない */
  NotFound: "FACILITY_NOT_FOUND",
  Forbidden: "FACILITY_FORBIDDEN",
  InvalidInput: "FACILITY_INVALID_INPUT",
  InvalidTransition: "FACILITY_INVALID_TRANSITION",
  HasUpcomingReservations: "FACILITY_HAS_UPCOMING_RESERVATIONS",
  PhotoStorageError: "FACILITY_PHOTO_STORAGE_ERROR",
  DatabaseError: "DATABASE_ERROR",
} as const;
export type FacilityErrorCode = (typeof FacilityErrorCode)[keyof typeof FacilityErrorCode];

/**
 * 施設まわりのエラーコードの分類（ADR-004 決定 3）。
 *
 * HTTP の status とログのレベルは、この表から決まる。
 */
export const facilityErrorKind: Record<FacilityErrorCode, ErrorKind> = {
  [FacilityErrorCode.NotFound]: ErrorKind.NotFound,
  [FacilityErrorCode.Forbidden]: ErrorKind.Forbidden,
  [FacilityErrorCode.InvalidInput]: ErrorKind.InvalidInput,
  [FacilityErrorCode.InvalidTransition]: ErrorKind.Conflict,
  [FacilityErrorCode.HasUpcomingReservations]: ErrorKind.Conflict,
  [FacilityErrorCode.PhotoStorageError]: ErrorKind.Internal,
  [FacilityErrorCode.DatabaseError]: ErrorKind.Internal,
};

/** どの入力項目についての誤りか（ADR-004 決定 4） */
export const FacilityField = {
  Name: "facility_name",
  Description: "facility_description",
  Photo: "facility_photo",
  GoogleCalendarId: "google_calendar_id",
} as const;
export type FacilityField = (typeof FacilityField)[keyof typeof FacilityField];

export interface FacilityError extends BaseError {
  readonly code: FacilityErrorCode;
  readonly field?: FacilityField;
}

/**
 * 施設に対して行える操作。
 */
export const FacilityAction = {
  ViewManagement: "view_management",
  Create: "create",
  Update: "update",
  ChangeStatus: "change_status",
} as const;
export type FacilityAction = (typeof FacilityAction)[keyof typeof FacilityAction];

/**
 * 施設・設備に関する権限の表（COND-009）。
 *
 * 【設計意図】
 * - base: 空の配列。施設管理（一覧・登録・編集・有効化/無効化）は一般ユーザーには一切許可しない。
 * - byRole: 事務局スタッフ（StaffRole）のみに全操作を許可する。
 * - 可否を分ける軸は「事務局かどうか」のみであり、団体での役割（管理者・メンバー）は関与しない。
 *   そのため PermissionTable の役割型には typeof StaffRole のみを渡す（authz の設計方針に従う）。
 */
export const facilityPermissions: PermissionTable<typeof StaffRole, FacilityAction> = {
  base: [],
  byRole: {
    [StaffRole]: [
      FacilityAction.ViewManagement,
      FacilityAction.Create,
      FacilityAction.Update,
      FacilityAction.ChangeStatus,
    ],
  },
};

/** 施設の新規登録に必要な入力 */
export interface CreateFacilityInput {
  readonly name: string;
  readonly description: string | null;
  readonly photoUrl: string | null;
  readonly googleCalendarId: string | null;
  readonly calendarUrl: string | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** 施設の更新に必要な入力 */
export interface UpdateFacilityInput {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly photoUrl: string | null;
  readonly googleCalendarId: string | null;
  readonly calendarUrl: string | null;
  readonly updatedAt: Date;
}

/** 施設のアクティブ状態更新に必要な入力 */
export interface UpdateFacilityActiveStatusInput {
  readonly id: string;
  readonly from: boolean;
  readonly to: boolean;
  readonly updatedAt: Date;
  readonly now: Date;
}

export interface FacilityRepository {
  findById(id: string): ResultAsync<Facility, FacilityError>;
  create(input: CreateFacilityInput): ResultAsync<Facility, FacilityError>;
  update(input: UpdateFacilityInput): ResultAsync<Facility, FacilityError>;
  countBlockingReservations(facilityId: string, now: Date): ResultAsync<number, FacilityError>;
  updateActiveStatus(input: UpdateFacilityActiveStatusInput): ResultAsync<Facility, FacilityError>;
}

/**
 * 施設・設備を利用できる時間帯（日本時間）。開始時刻を含み、終了時刻は含まない。
 *
 * 全施設で同じ値にしているのは、INFO-002（施設/設備）に利用可能時間の属性が無いため。
 * 施設ごとに変えたくなったら、まず INFO-002 に属性を足すこと。
 * ここを施設ごとの分岐で増やすと、情報モデルに無い値が画面の中だけで増えていく。
 *
 * 空き状況カレンダー（SCR-001）の時間軸は、この 2 つの値だけで決まる。
 */
export const FACILITY_OPEN_HOUR = 9;
export const FACILITY_CLOSE_HOUR = 21;
