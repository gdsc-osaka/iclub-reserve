/**
 * 予約申請・変更フォームが送ってくる文字列を、申請・変更の中身へ変える（SCR-002 / UC-002 / UC-005 / UC-017）。
 *
 * ここは action 側の入り口にあたる部分だけを集めている。
 * 画面を描かずに確かめられるように、React に触れるものは置かない。
 *
 * 欄の名前（`FieldErrors` のキー）は、日時を選ぶ部品（このフォルダの部品）も
 * エラーの表示に使うので、画面のフォルダではなくここに置いている。
 */

import {
  RESERVATION_MIN_HEAD_COUNT,
  RESERVATION_NOTE_MAX_LENGTH,
  ReservationField,
} from "~/domain/reservation";
import type { ReservationContent } from "~/domain/reservation/edit";
import { validateReservationPeriod } from "~/domain/reservation/validation";
import { atTokyoMinutes, parseTokyoDateKey, parseTokyoTimeKey } from "~/lib/date";

/**
 * 申請フォームで何を作るか。仮予約の申請（UC-002）か、事務局による承認済みの直接作成（UC-008）か。
 *
 * 選べるのは事務局だけで、事務局でない人が "direct" を送っても直接作成のユースケースが止める。
 */
export type ReservationFormMode = "provisional" | "direct";

/** フォームが送ってくる値。入力し直してもらうためにそのまま持ち帰る */
export interface FormValues {
  readonly groupId: string;
  readonly facilityId: string;
  readonly dateKey: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly headCount: string;
  readonly note: string;
  /** 決まった値以外が送られてきたら、仮予約の申請として扱う */
  readonly mode: ReservationFormMode;
}

/**
 * 誤りを出す欄の名前。
 *
 * 日付・開始・終了は 3 つで 1 つの「日時」なので、まとめて `period` に出す。
 * 欄ごとに分けても、直すべき組み合わせが伝わらない。
 */
type FieldKey = "groupId" | "facilityId" | "period" | "headCount" | "note";

/** 入力の欄ごとのエラー。誤りのある欄だけを持つ */
export type FieldErrors = Partial<Record<FieldKey, string>>;

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
  mode: readString(formData, "mode") === "direct" ? "direct" : "provisional",
});

/**
 * フォームの文字列から、団体以外の項目（施設・日時・使用人数・備考）を解釈する。
 *
 * 予約の変更（UC-005 / UC-017）は団体を変えられないので、こちらを直接使う。
 * 申請（`parseReservation`）も、これに団体の確認を足しただけである。
 * 返す値は、ドメインの `ReservationContent` にそのまま渡せる形にそろえている。
 *
 * 欄ごとのエラーを作るのがここの仕事で、申請・変更できるかどうか（COND-001・COND-006 など）は見ない。
 * あちらは DB を引かないと分からないのでユースケース層が確かめる。
 *
 * 利用時間の判定にドメインの `validateReservationPeriod` をそのまま使っているのは、
 * 同じ規則をここにもう一度書くと、片方だけ直したときに食い違うため。
 */
export const parseReservationContent = (
  values: Pick<
    FormValues,
    "facilityId" | "dateKey" | "startTime" | "endTime" | "headCount" | "note"
  >,
  now: Date,
): { readonly content: ReservationContent | null; readonly fieldErrors: FieldErrors } => {
  const fieldErrors: FieldErrors = {};

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
      // message はログ用なので出さない。利用時間の検証はどの誤りにも userMessage を付けている
      fieldErrors.period = validated.error.userMessage ?? "日付と時間帯を確認してください。";
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
    return { content: null, fieldErrors };
  }

  return {
    content: {
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
 * フォームの文字列を、申請の中身に変える（UC-002 / UC-008）。
 *
 * 団体以外の項目は `parseReservationContent` に任せ、ここでは申請元の団体だけを確かめる。
 */
export const parseReservation = (
  values: FormValues,
  now: Date,
): { readonly reservation: ParsedReservation | null; readonly fieldErrors: FieldErrors } => {
  const { content, fieldErrors } = parseReservationContent(values, now);

  if (values.groupId === "") fieldErrors.groupId = "申請元の団体を選んでください。";

  if (content === null || fieldErrors.groupId !== undefined) {
    return { reservation: null, fieldErrors };
  }

  return {
    reservation: {
      groupId: values.groupId,
      facilityId: content.facilityId,
      startAt: content.startAt,
      endAt: content.endAt,
      headCount: content.headCount,
      note: content.note,
    },
    fieldErrors,
  };
};

/**
 * ドメインの項目（`ReservationField`）から、この画面の欄を引く表（ADR-004 決定 6）。
 *
 * どのエラーをどの欄に出すかは、ドメインが付けた `field` とこの表だけで決まる。
 * 団体・施設の状態や、承認済みの予約との重なりも、それぞれの欄の下に出る。
 * 選び直せば通るので、どれを選び直せばよいかが欄の位置で伝わる。
 *
 * 載っていない項目の誤りと、項目を持たない誤り（権限・DB の失敗など）はフォームの上に出る。
 */
export const fieldKeyOf = {
  [ReservationField.Group]: "groupId",
  [ReservationField.Facility]: "facilityId",
  [ReservationField.Period]: "period",
  [ReservationField.HeadCount]: "headCount",
  [ReservationField.Note]: "note",
} as const satisfies Partial<Record<ReservationField, FieldKey>>;

/**
 * action の誤り（`app/routes/_shared/` のグルーが返す形）を、この画面の形に直す。
 *
 * グルーは誤りの無い欄も null で並べて返すが、この画面は誤りのある欄だけを持つ形で受け取る。
 * `parseReservation` が複数の欄に同時に誤りを出すので、そちらに形を揃えている。
 */
export const toFormErrors = ({
  formError,
  ...fields
}: { readonly formError: string | null } & Partial<Record<FieldKey, string | null>>): {
  readonly fieldErrors: FieldErrors;
  readonly formError: string | null;
} => ({
  fieldErrors: Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [FieldKey, string] => typeof entry[1] === "string",
    ),
  ),
  formError,
});
