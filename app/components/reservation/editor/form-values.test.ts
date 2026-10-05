import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RESERVATION_MIN_HEAD_COUNT,
  RESERVATION_NOTE_MAX_LENGTH,
  ReservationErrorCode,
  ReservationField,
  type ReservationError,
} from "~/domain/reservation";
import { reservationActionErrors } from "~/routes/_shared/reservation-error.server";

import {
  fieldKeyOf,
  parseReservation,
  parseReservationContent,
  readValues,
  toFormErrors,
  type FormValues,
} from "./form-values";

/** 2026 年 9 月 16 日（水）9:00。この時刻より前は「過ぎた日時」になる */
const now = new Date("2026-09-16T09:00:00+09:00");

/** そのままなら申請が通る入力。確かめたい欄だけ上書きして使う */
const values = (overrides: Partial<FormValues> = {}): FormValues => ({
  groupId: "grp_robotics",
  facilityId: "fac_meeting_a",
  dateKey: "2026-09-16",
  startTime: "13:00",
  endTime: "15:00",
  headCount: "4",
  note: "",
  mode: "provisional",
  ...overrides,
});

const error = (
  code: ReservationErrorCode,
  extra: Partial<ReservationError> = {},
): ReservationError => ({
  code,
  message: "ログ用の説明",
  ...extra,
});

/** action と同じ道筋（グルー → この画面の欄の表 → この画面の形）で、エラーを画面の形にする */
const formErrorsOf = (reservationError: ReservationError) =>
  toFormErrors(
    reservationActionErrors(
      { where: "reservations.new.test", userId: "usr_01" },
      reservationError,
      fieldKeyOf,
    ),
  );

describe("readValues", () => {
  it("フォームの name をそのまま読み取る", () => {
    const formData = new FormData();
    formData.set("group_id", "grp_robotics");
    formData.set("facility_id", "fac_meeting_a");
    formData.set("date", "2026-09-16");
    formData.set("start_time", "13:00");
    formData.set("end_time", "15:00");
    formData.set("head_count", "4");
    formData.set("note", "定例ミーティング");

    expect(readValues(formData)).toEqual({
      groupId: "grp_robotics",
      facilityId: "fac_meeting_a",
      dateKey: "2026-09-16",
      startTime: "13:00",
      endTime: "15:00",
      headCount: "4",
      note: "定例ミーティング",
      mode: "provisional",
    });
  });

  it("欄が無いときや、文字列でないものが送られてきたときは空文字にする", () => {
    const formData = new FormData();
    formData.set("note", new Blob(["添付されたもの"]));

    expect(readValues(formData)).toMatchObject({ groupId: "", note: "" });
  });

  it.each([
    ["direct", "direct"],
    ["provisional", "provisional"],
    ["approved", "provisional"],
    [null, "provisional"],
  ] as const)("mode に %s が送られてきたら %s として読む", (sent, expected) => {
    const formData = new FormData();
    if (sent !== null) formData.set("mode", sent);

    expect(readValues(formData).mode).toBe(expected);
  });
});

describe("parseReservation", () => {
  it("揃っていれば、日本時間の日時に組み立てて返す", () => {
    const { reservation, fieldErrors } = parseReservation(values(), now);

    expect(fieldErrors).toEqual({});
    expect(reservation).toMatchObject({
      groupId: "grp_robotics",
      facilityId: "fac_meeting_a",
      headCount: 4,
    });
    expect(reservation?.startAt).toEqual(new Date("2026-09-16T13:00:00+09:00"));
    expect(reservation?.endAt).toEqual(new Date("2026-09-16T15:00:00+09:00"));
  });

  it("備考は前後の空白を落とす。空欄は「書かなかった」として null にする（INFO-001）", () => {
    expect(parseReservation(values({ note: "  準備に使います  " }), now).reservation?.note).toBe(
      "準備に使います",
    );
    expect(parseReservation(values({ note: "   " }), now).reservation?.note).toBeNull();
  });

  it("団体と施設が未選択なら、それぞれの欄にエラーを出す", () => {
    const { reservation, fieldErrors } = parseReservation(
      values({ groupId: "", facilityId: "" }),
      now,
    );

    expect(reservation).toBeNull();
    expect(fieldErrors.groupId).toBeDefined();
    expect(fieldErrors.facilityId).toBeDefined();
  });

  it("日付や時刻が読めないときは、3 つまとめて日時のエラーにする", () => {
    expect(parseReservation(values({ dateKey: "2026/09/16" }), now).fieldErrors.period).toBe(
      "日付と時間帯を選んでください。",
    );
    expect(parseReservation(values({ startTime: "" }), now).fieldErrors.period).toBe(
      "日付と時間帯を選んでください。",
    );
    expect(parseReservation(values({ endTime: "25:00" }), now).fieldErrors.period).toBe(
      "日付と時間帯を選んでください。",
    );
  });

  it("利用できる時間かどうかの判定は、ドメインの文言をそのまま出す", () => {
    // 利用可能時間の外（9:00〜21:00）
    expect(parseReservation(values({ startTime: "08:00" }), now).fieldErrors.period).toContain(
      "利用できるのは",
    );
    // 終わりが始まりより前
    expect(parseReservation(values({ endTime: "12:00" }), now).fieldErrors.period).toBe(
      "終了時刻は開始時刻より後にしてください。",
    );
    // 過ぎた日時
    expect(
      parseReservation(values({ dateKey: "2026-09-15", startTime: "10:00" }), now).fieldErrors
        .period,
    ).toBe("過ぎた日時には申請できません。");
  });

  it("使用人数が空・下限未満・整数でないときはエラーにする", () => {
    const message = `使用人数は ${RESERVATION_MIN_HEAD_COUNT} 以上の整数で入力してください。`;

    expect(parseReservation(values({ headCount: "" }), now).fieldErrors.headCount).toBe(message);
    expect(parseReservation(values({ headCount: "0" }), now).fieldErrors.headCount).toBe(message);
    expect(parseReservation(values({ headCount: "1.5" }), now).fieldErrors.headCount).toBe(message);
    expect(parseReservation(values({ headCount: "四" }), now).fieldErrors.headCount).toBe(message);
  });

  it("備考が長すぎるときはエラーにする", () => {
    const note = "あ".repeat(RESERVATION_NOTE_MAX_LENGTH + 1);

    expect(parseReservation(values({ note }), now).fieldErrors.note).toBe(
      `備考は ${RESERVATION_NOTE_MAX_LENGTH} 文字以内で入力してください。`,
    );
  });

  it("エラーが 1 つでもあれば、申請の中身は作らない", () => {
    expect(parseReservation(values({ headCount: "0" }), now).reservation).toBeNull();
  });
});

describe("parseReservationContent", () => {
  it("団体（groupId）が無くても通る", () => {
    const { content, fieldErrors } = parseReservationContent(values({ groupId: "" }), now);

    expect(fieldErrors).toEqual({});
    expect(content).toMatchObject({
      facilityId: "fac_meeting_a",
      headCount: 4,
    });
    expect(content?.startAt).toEqual(new Date("2026-09-16T13:00:00+09:00"));
    expect(content?.endAt).toEqual(new Date("2026-09-16T15:00:00+09:00"));
  });

  it("備考は前後の空白を落とし、空欄は null にする", () => {
    expect(parseReservationContent(values({ note: "  打ち合わせ  " }), now).content?.note).toBe(
      "打ち合わせ",
    );
    expect(parseReservationContent(values({ note: "   " }), now).content?.note).toBeNull();
  });

  it("施設が未選択ならエラーにする", () => {
    const { content, fieldErrors } = parseReservationContent(values({ facilityId: "" }), now);

    expect(content).toBeNull();
    expect(fieldErrors.facilityId).toBeDefined();
  });

  it("日時の形式が不正・範囲外・過去日ならエラーにする", () => {
    expect(parseReservationContent(values({ dateKey: "" }), now).fieldErrors.period).toBe(
      "日付と時間帯を選んでください。",
    );
    expect(
      parseReservationContent(values({ startTime: "08:00" }), now).fieldErrors.period,
    ).toContain("利用できるのは");
  });

  it("人数や備考が不正ならエラーにする", () => {
    expect(parseReservationContent(values({ headCount: "0" }), now).fieldErrors.headCount).toBe(
      `使用人数は ${RESERVATION_MIN_HEAD_COUNT} 以上の整数で入力してください。`,
    );

    const note = "あ".repeat(RESERVATION_NOTE_MAX_LENGTH + 1);
    expect(parseReservationContent(values({ note }), now).fieldErrors.note).toBe(
      `備考は ${RESERVATION_NOTE_MAX_LENGTH} 文字以内で入力してください。`,
    );
  });
});

describe("申請のエラーを出す欄", () => {
  beforeEach(() => {
    // グルーはどの失敗もログに残す。ここでは出力を黙らせるだけ
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("利用時間の誤りと、承認済みの予約との重なりは、日時の欄に出す", () => {
    expect(
      formErrorsOf(
        error(ReservationErrorCode.InvalidPeriod, {
          field: ReservationField.Period,
          userMessage: "過ぎた日時には申請できません。",
        }),
      ),
    ).toEqual({ fieldErrors: { period: "過ぎた日時には申請できません。" }, formError: null });

    expect(
      formErrorsOf(
        error(ReservationErrorCode.Conflict, {
          field: ReservationField.Period,
          userMessage: "選んだ時間帯には、すでに承認済みの予約が入っています。",
        }),
      ).fieldErrors.period,
    ).toBe("選んだ時間帯には、すでに承認済みの予約が入っています。");
  });

  it("申請元の団体・施設が使えないときは、それぞれの欄に出す", () => {
    expect(
      formErrorsOf(
        error(ReservationErrorCode.GroupNotEligible, {
          field: ReservationField.Group,
          userMessage: "予約を申請できるのは、事務局が有効にした団体だけです。",
        }),
      ).fieldErrors,
    ).toEqual({ groupId: "予約を申請できるのは、事務局が有効にした団体だけです。" });

    expect(
      formErrorsOf(
        error(ReservationErrorCode.FacilityNotAvailable, {
          field: ReservationField.Facility,
          userMessage: "選んだ施設・設備は、いま予約を受け付けていません。",
        }),
      ).fieldErrors,
    ).toEqual({ facilityId: "選んだ施設・設備は、いま予約を受け付けていません。" });
  });

  it("使用人数と備考の誤りは、フォームの上ではなくそれぞれの欄に出す", () => {
    // これまではコードから項目を見分けられず、どちらもフォームの上に出ていた
    expect(
      formErrorsOf(
        error(ReservationErrorCode.InvalidInput, {
          field: ReservationField.HeadCount,
          userMessage: "使用人数は 1 以上の整数で入力してください。",
        }),
      ),
    ).toEqual({
      fieldErrors: { headCount: "使用人数は 1 以上の整数で入力してください。" },
      formError: null,
    });

    expect(
      formErrorsOf(
        error(ReservationErrorCode.InvalidInput, {
          field: ReservationField.Note,
          userMessage: "備考は 500 文字以内で入力してください。",
        }),
      ).fieldErrors,
    ).toEqual({ note: "備考は 500 文字以内で入力してください。" });
  });

  it("項目を持たない失敗は、フォームの上に出す", () => {
    expect(
      formErrorsOf(
        error(ReservationErrorCode.Forbidden, {
          userMessage: "この団体で予約を申請する権限がありません。",
        }),
      ),
    ).toEqual({ fieldErrors: {}, formError: "この団体で予約を申請する権限がありません。" });
  });

  it("DB の失敗は中身を伝えず、共通の案内に置き換える", () => {
    expect(
      formErrorsOf(
        error(ReservationErrorCode.DatabaseError, { userMessage: "D1 に接続できませんでした。" }),
      ),
    ).toEqual({
      fieldErrors: {},
      formError: "操作できませんでした。時間をおいて、もう一度お試しください。",
    });
  });
});
