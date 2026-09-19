/**
 * 申請フォームが送ってくる文字列を、申請の中身へ変える（SCR-002 / UC-002）。
 *
 * ここは action 側の入り口にあたる部分だけを集めている。
 * 画面を描かずに確かめられるように、React に触れるものは置かない。
 */

import {
  RESERVATION_MIN_HEAD_COUNT,
  RESERVATION_NOTE_MAX_LENGTH,
  ReservationErrorCode,
  type ReservationError,
} from "~/domain/reservation";
import { validateReservationPeriod } from "~/domain/reservation/validation";
import { atTokyoMinutes, parseTokyoDateKey, parseTokyoTimeKey } from "~/lib/date";

/** フォームが送ってくる値。入力し直してもらうためにそのまま持ち帰る */
export interface FormValues {
  readonly groupId: string;
  readonly facilityId: string;
  readonly dateKey: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly headCount: string;
  readonly note: string;
}

/**
 * 入力の欄ごとのエラー。
 *
 * 日付・開始・終了は 3 つで 1 つの「日時」なので、まとめて `period` に出す。
 * 欄ごとに分けても、直すべき組み合わせが伝わらない。
 */
export type FieldErrors = Partial<
  Record<"groupId" | "facilityId" | "period" | "headCount" | "note", string>
>;

const readString = (formData: FormData, name: string): string => {
  const value = formData.get(name);

  return typeof value === "string" ? value : "";
};

export const readValues = (formData: FormData): FormValues => ({
  groupId: readString(formData, "group_id"),
  facilityId: readString(formData, "facility_id"),
  dateKey: readString(formData, "date"),
  startTime: readString(formData, "start_time"),
  endTime: readString(formData, "end_time"),
  headCount: readString(formData, "head_count"),
  note: readString(formData, "note"),
});

/** 申請の中身。フォームの文字列を確かめ終えた形 */
export interface ParsedReservation {
  readonly groupId: string;
  readonly facilityId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly headCount: number;
  readonly note: string | null;
}

/**
 * フォームの文字列を、申請の中身に変える。
 *
 * 欄ごとのエラーを作るのがここの仕事で、申請できるかどうか（COND-001・COND-006）は見ない。
 * あちらは DB を引かないと分からないのでユースケース層が確かめる。
 *
 * 利用時間の判定にドメインの `validateReservationPeriod` をそのまま使っているのは、
 * 同じ規則をここにもう一度書くと、片方だけ直したときに食い違うため。
 */
export const parseReservation = (
  values: FormValues,
  now: Date,
): { readonly reservation: ParsedReservation | null; readonly fieldErrors: FieldErrors } => {
  const fieldErrors: FieldErrors = {};

  if (values.groupId === "") fieldErrors.groupId = "申請元の団体を選んでください。";
  if (values.facilityId === "") fieldErrors.facilityId = "施設・設備を選んでください。";

  const day = parseTokyoDateKey(values.dateKey);
  const startMinutes = parseTokyoTimeKey(values.startTime);
  const endMinutes = parseTokyoTimeKey(values.endTime);

  let startAt: Date | null = null;
  let endAt: Date | null = null;

  if (day === null || startMinutes === null || endMinutes === null) {
    fieldErrors.period = "日付と時間帯を選んでください。";
  } else {
    const period = {
      startAt: atTokyoMinutes(day, startMinutes),
      endAt: atTokyoMinutes(day, endMinutes),
    };
    const validated = validateReservationPeriod(period, now);

    if (validated.isErr()) {
      fieldErrors.period = validated.error.message;
    } else {
      startAt = period.startAt;
      endAt = period.endAt;
    }
  }

  const headCount = Number(values.headCount);

  if (
    values.headCount.trim() === "" ||
    !Number.isSafeInteger(headCount) ||
    headCount < RESERVATION_MIN_HEAD_COUNT
  ) {
    fieldErrors.headCount = `使用人数は ${RESERVATION_MIN_HEAD_COUNT} 以上の整数で入力してください。`;
  }

  const note = values.note.trim();

  if (note.length > RESERVATION_NOTE_MAX_LENGTH) {
    fieldErrors.note = `備考は ${RESERVATION_NOTE_MAX_LENGTH} 文字以内で入力してください。`;
  }

  if (Object.keys(fieldErrors).length > 0 || startAt === null || endAt === null) {
    return { reservation: null, fieldErrors };
  }

  return {
    reservation: {
      groupId: values.groupId,
      facilityId: values.facilityId,
      startAt,
      endAt,
      headCount,
      // 備考は任意（INFO-001）。空欄は「書かなかった」として null で保存する
      note: note === "" ? null : note,
    },
    fieldErrors,
  };
};

/**
 * ユースケースのエラーを、画面のどこに出すかへ振り分ける。
 *
 * DB の失敗だけは中身を伝えない。利用者には直しようがなく、
 * 内部の事情を画面に出しても不安にさせるだけのため。
 */
export const toFormErrors = (
  error: ReservationError,
): { readonly fieldErrors: FieldErrors; readonly formError: string | null } => {
  switch (error.code) {
    case ReservationErrorCode.ReservationInvalidPeriod:
    case ReservationErrorCode.ReservationConflict:
      return { fieldErrors: { period: error.message }, formError: null };

    case ReservationErrorCode.ReservationForbidden:
    case ReservationErrorCode.ReservationGroupNotEligible:
      return { fieldErrors: { groupId: error.message }, formError: null };

    case ReservationErrorCode.ReservationFacilityNotAvailable:
      return { fieldErrors: { facilityId: error.message }, formError: null };

    case ReservationErrorCode.ReservationInvalidInput:
      return { fieldErrors: {}, formError: error.message };

    default:
      return {
        fieldErrors: {},
        formError: "申請できませんでした。時間をおいて、もう一度お試しください。",
      };
  }
};
