import { describe, expect, it } from "vitest";

import { ReservationErrorCode, ReservationField } from ".";
import { validateReservationDraft, validateReservationPeriod } from "./validation";

/** 判定の基準になる「いま」。2026 年 9 月 14 日（月）の 9 時 */
const now = new Date("2026-09-14T09:00:00+09:00");

/** 「いま」より後の、同じ週の水曜日の時刻 */
const wednesday = (time: string) => new Date(`2026-09-16T${time}:00+09:00`);

describe("validateReservationPeriod", () => {
  it("利用可能時間の中で 30 分単位に収まっていれば通る", () => {
    const period = { startAt: wednesday("10:00"), endAt: wednesday("12:00") };

    expect(validateReservationPeriod(period, now).isOk()).toBe(true);
  });

  it("最短の 30 分でも通る", () => {
    const period = { startAt: wednesday("09:00"), endAt: wednesday("09:30") };

    expect(validateReservationPeriod(period, now).isOk()).toBe(true);
  });

  it("終了が開始より前なら弾く", () => {
    const period = { startAt: wednesday("12:00"), endAt: wednesday("10:00") };
    const result = validateReservationPeriod(period, now);

    // 画面が「日時」の欄の下に出せるよう、どの項目の誤りかを添える（ADR-004 決定 6）
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.InvalidPeriod,
      field: ReservationField.Period,
    });
  });

  it("長さが 0 なら弾く", () => {
    const period = { startAt: wednesday("10:00"), endAt: wednesday("10:00") };

    expect(validateReservationPeriod(period, now).isErr()).toBe(true);
  });

  it("30 分刻みでない時刻は弾く", () => {
    const period = { startAt: wednesday("10:15"), endAt: wednesday("11:15") };
    const result = validateReservationPeriod(period, now);

    expect(result._unsafeUnwrapErr().userMessage).toContain("30 分単位");
  });

  it("利用可能時間より前から始まる予約は弾く", () => {
    const period = { startAt: wednesday("08:30"), endAt: wednesday("10:00") };
    const result = validateReservationPeriod(period, now);

    expect(result._unsafeUnwrapErr().userMessage).toContain("9:00〜21:00");
  });

  it("利用可能時間より後まで続く予約は弾く", () => {
    const period = { startAt: wednesday("20:00"), endAt: wednesday("21:30") };

    expect(validateReservationPeriod(period, now).isErr()).toBe(true);
  });

  it("日をまたぐ予約は弾く", () => {
    const period = {
      startAt: wednesday("20:00"),
      endAt: new Date("2026-09-17T10:00:00+09:00"),
    };
    const result = validateReservationPeriod(period, now);

    expect(result._unsafeUnwrapErr().userMessage).toContain("日をまたぐ");
  });

  it("過ぎた日時は弾く", () => {
    const period = {
      startAt: new Date("2026-09-13T10:00:00+09:00"),
      endAt: new Date("2026-09-13T12:00:00+09:00"),
    };
    const result = validateReservationPeriod(period, now);

    expect(result._unsafeUnwrapErr().userMessage).toContain("過ぎた日時");
  });
});

describe("validateReservationDraft", () => {
  const period = { startAt: wednesday("10:00"), endAt: wednesday("12:00") };

  it("使用人数があり、備考が上限内なら通る", () => {
    const result = validateReservationDraft({ ...period, headCount: 4, note: "週次定例" }, now);

    expect(result.isOk()).toBe(true);
  });

  it("備考は書かなくてもよい（INFO-001 で任意）", () => {
    const result = validateReservationDraft({ ...period, headCount: 1, note: null }, now);

    expect(result.isOk()).toBe(true);
  });

  it("使用人数が 0 以下なら弾く", () => {
    const result = validateReservationDraft({ ...period, headCount: 0, note: null }, now);

    // 同じ InvalidInput でも、使用人数と備考のどちらの誤りかを field で見分けられる
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.InvalidInput,
      field: ReservationField.HeadCount,
    });
  });

  it("使用人数が整数でなければ弾く", () => {
    const result = validateReservationDraft({ ...period, headCount: 2.5, note: null }, now);

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.InvalidInput);
  });

  it("備考が 500 文字を超えたら弾く", () => {
    const result = validateReservationDraft(
      { ...period, headCount: 4, note: "あ".repeat(501) },
      now,
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.InvalidInput,
      field: ReservationField.Note,
    });
  });

  it("利用時間が不正なら、使用人数を見る前に弾く", () => {
    const result = validateReservationDraft(
      { startAt: wednesday("10:15"), endAt: wednesday("11:15"), headCount: 0, note: null },
      now,
    );

    // 先に返るのは利用時間のエラー。直す順番が読み取れるようにしておく
    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.InvalidPeriod);
  });
});
