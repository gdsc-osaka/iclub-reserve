import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReservationErrorCode, type ReservationError } from "~/domain/reservation";

import { reservationActionErrors, reservationErrorResponse } from "./reservation-error.server";

const context = { where: "reservations.test", userId: "usr_01" };

const errorOf = (
  code: ReservationErrorCode,
  extra: Partial<ReservationError> = {},
): ReservationError => ({
  code,
  message: "ログ用の説明",
  ...extra,
});

beforeEach(() => {
  // ログの中身は個別のテストで確かめる。ここでは出力を黙らせるだけ
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("COND-008: 見られない予約は、無い予約と同じ応答になる", () => {
  it("loader の応答（status と中身）が NotFound と同一になる", () => {
    const notVisible = reservationErrorResponse(context, errorOf(ReservationErrorCode.NotVisible));
    const notFound = reservationErrorResponse(context, errorOf(ReservationErrorCode.NotFound));

    expect(notVisible.init?.status).toBe(404);
    expect(notVisible).toEqual(notFound);
  });

  it("action の応答も NotFound と同一になる", () => {
    expect(reservationActionErrors(context, errorOf(ReservationErrorCode.NotVisible))).toEqual(
      reservationActionErrors(context, errorOf(ReservationErrorCode.NotFound)),
    );
  });

  it.each([ReservationErrorCode.NotVisible, ReservationErrorCode.NotFound])(
    "%s に userMessage が付いていても、応答は変わらない",
    (code) => {
      // どちらかに文言を書いてしまっても、その有無で 2 つの応答に差が出ないこと
      const written = errorOf(code, { userMessage: "この予約は他の団体のものです。" });

      expect(reservationErrorResponse(context, written)).toEqual(
        reservationErrorResponse(context, errorOf(ReservationErrorCode.NotFound)),
      );
      expect(reservationActionErrors(context, written)).toEqual(
        reservationActionErrors(context, errorOf(ReservationErrorCode.NotFound)),
      );
    },
  );

  it("ログには秘匿せず、NotVisible として warn で残る", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    reservationErrorResponse(context, errorOf(ReservationErrorCode.NotVisible));

    // 秘匿が要るのは外部への応答で、サーバーのログではない（ADR-004 決定 4）
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        code: "RESERVATION_NOT_VISIBLE",
        kind: "forbidden",
        userId: "usr_01",
      }),
    );
  });
});

describe("reservationErrorResponse", () => {
  it("DB の失敗は 500 で、内部の事情を応答に出さない", () => {
    const response = reservationErrorResponse(
      context,
      errorOf(ReservationErrorCode.DatabaseError, { message: "D1_ERROR: no such table" }),
    );

    expect(response.init?.status).toBe(500);
    expect(JSON.stringify(response.data)).not.toContain("D1_ERROR");
  });
});

describe("reservationActionErrors", () => {
  it("予約が無いときは画面ごと差し替えず、一覧の上に読み込み直しの案内を出す", () => {
    // 一覧の操作は予約をフォームの値で指している。一覧の画面そのものはあるので、404 を投げてはいけない
    expect(reservationActionErrors(context, errorOf(ReservationErrorCode.NotFound))).toEqual({
      formError: "対象の予約が見つかりませんでした。画面を読み込み直してください。",
    });
  });

  it("権限の拒否は、ドメインが書いた文言をそのまま出す（画面によって言い方が変わらない）", () => {
    // これまで予約一覧では固定の文言、申請画面ではドメインの文言が出ていた（ADR-004 コンテキストの 3）
    const errors = reservationActionErrors(
      context,
      errorOf(ReservationErrorCode.Forbidden, {
        userMessage: "所属している団体の予約のみ操作できます。",
      }),
    );

    expect(errors).toEqual({ formError: "所属している団体の予約のみ操作できます。" });
  });

  it("userMessage が無いときは、表の文言を出す", () => {
    const errors = reservationActionErrors(context, errorOf(ReservationErrorCode.Forbidden));

    expect(errors.formError).toBe("この予約を操作する権限がありません。");
  });

  it("DB の失敗は、userMessage を持っていても表の汎用文言を出す", () => {
    const errors = reservationActionErrors(
      context,
      errorOf(ReservationErrorCode.DatabaseError, { userMessage: "D1 に接続できませんでした。" }),
    );

    expect(errors.formError).toBe("操作できませんでした。時間をおいて、もう一度お試しください。");
  });

  it.each([
    [ReservationErrorCode.InvalidInput, "info"],
    [ReservationErrorCode.InvalidPeriod, "info"],
    [ReservationErrorCode.InvalidTransition, "info"],
    [ReservationErrorCode.Conflict, "info"],
    [ReservationErrorCode.GroupNotEligible, "info"],
    [ReservationErrorCode.FacilityNotAvailable, "info"],
    [ReservationErrorCode.NotFound, "info"],
    [ReservationErrorCode.Forbidden, "warn"],
    [ReservationErrorCode.NotVisible, "warn"],
    [ReservationErrorCode.DatabaseError, "error"],
  ] as const)("%s は %s でログに残る（残さないという選択肢は無い）", (code, level) => {
    const spy = vi.spyOn(console, level).mockImplementation(() => {});

    reservationActionErrors(context, errorOf(code));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ level, code, userId: "usr_01" }));
  });
});
