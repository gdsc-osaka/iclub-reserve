import { describe, expect, it } from "vitest";

import {
  RESERVATION_MIN_HEAD_COUNT,
  RESERVATION_NOTE_MAX_LENGTH,
  ReservationErrorCode,
  type ReservationError,
} from "~/domain/reservation";

import { parseReservation, readValues, toFormErrors, type FormValues } from "./form-values";

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
  ...overrides,
});

const error = (code: ReservationErrorCode): ReservationError => ({ code, message: "元の文言" });

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
    });
  });

  it("欄が無いときや、文字列でないものが送られてきたときは空文字にする", () => {
    const formData = new FormData();
    formData.set("note", new Blob(["添付されたもの"]));

    expect(readValues(formData)).toMatchObject({ groupId: "", note: "" });
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

describe("toFormErrors", () => {
  it("時間帯にまつわるエラーは、日時の欄に出す", () => {
    expect(toFormErrors(error(ReservationErrorCode.ReservationInvalidPeriod))).toEqual({
      fieldErrors: { period: "元の文言" },
      formError: null,
    });
    expect(toFormErrors(error(ReservationErrorCode.ReservationConflict)).fieldErrors.period).toBe(
      "元の文言",
    );
  });

  it("申請元の団体にまつわるエラーは、団体の欄に出す", () => {
    expect(toFormErrors(error(ReservationErrorCode.ReservationForbidden)).fieldErrors.groupId).toBe(
      "元の文言",
    );
    expect(
      toFormErrors(error(ReservationErrorCode.ReservationGroupNotEligible)).fieldErrors.groupId,
    ).toBe("元の文言");
  });

  it("施設にまつわるエラーは、施設の欄に出す", () => {
    expect(
      toFormErrors(error(ReservationErrorCode.ReservationFacilityNotAvailable)).fieldErrors
        .facilityId,
    ).toBe("元の文言");
  });

  it("欄を特定できない入力のエラーは、フォーム全体のエラーにする", () => {
    expect(toFormErrors(error(ReservationErrorCode.ReservationInvalidInput))).toEqual({
      fieldErrors: {},
      formError: "元の文言",
    });
  });

  it("DB の失敗は中身を伝えず、共通の案内に置き換える", () => {
    expect(toFormErrors(error(ReservationErrorCode.DatabaseError))).toEqual({
      fieldErrors: {},
      formError: "申請できませんでした。時間をおいて、もう一度お試しください。",
    });
  });
});
