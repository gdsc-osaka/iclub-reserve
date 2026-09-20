import { describe, expect, it } from "vitest";

import { ReservationErrorCode, type ReservationError } from "~/domain/reservation";
import { toActionErrorMessage } from "./action-error";

const errorOf = (code: ReservationErrorCode, message: string): ReservationError => ({
  code,
  message,
});

describe("toActionErrorMessage", () => {
  it("どうすれば直せるかを伝えるエラーは、ドメインの文言をそのまま出す", () => {
    expect(
      toActionErrorMessage(
        errorOf(ReservationErrorCode.ReservationInvalidInput, "却下理由を入力してください。"),
      ),
    ).toBe("却下理由を入力してください。");

    expect(
      toActionErrorMessage(
        errorOf(
          ReservationErrorCode.ReservationConflict,
          "同一施設・同一時間帯に別の承認済み予約が存在します。先にそちらをキャンセルしてください。",
        ),
      ),
    ).toContain("先にそちらをキャンセル");
  });

  it("DB の失敗は、内部の文言を画面へ出さない", () => {
    const message = toActionErrorMessage(
      errorOf(ReservationErrorCode.DatabaseError, "Failed to query the database"),
    );

    expect(message).not.toContain("database");
    expect(message).toBe("操作できませんでした。時間をおいて、もう一度お試しください。");
  });

  it("見つからない・権限が無いも、内部の文言を画面へ出さない", () => {
    expect(
      toActionErrorMessage(
        errorOf(ReservationErrorCode.ReservationNotFound, "Reservation not Found"),
      ),
    ).toBe("予約が見つかりませんでした。画面を読み込み直してください。");

    expect(
      toActionErrorMessage(
        errorOf(ReservationErrorCode.ReservationForbidden, "reservation.groupId mismatch"),
      ),
    ).toBe("この予約を操作する権限がありません。");
  });
});
