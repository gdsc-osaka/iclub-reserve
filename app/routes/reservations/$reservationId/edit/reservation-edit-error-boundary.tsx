import { ReservationEditError } from "~/components/reservation/reservation-edit-error";
import type { AppArea } from "~/lib/app-area";
import {
  toReservationListPath,
  toReservationListScope,
} from "~/routes/reservations/list/query-params";

/**
 * 予約の変更の入口で例外が起きたときに出す画面。変更できない理由は、空き状況カレンダーの変更の欄と同じ画面で出す。
 * 戻り先は、開いていた画面の予約一覧にする（ADR-016 決定 15）。
 */
export function ReservationEditEntryErrorBoundary({
  error,
  reservationId,
  area,
}: Readonly<{ error: unknown; reservationId: string | undefined; area: AppArea }>) {
  return (
    <ReservationEditError
      error={error}
      reservationId={reservationId}
      area={area}
      backLink={{
        to: toReservationListPath({}, toReservationListScope(area)),
        label: "予約一覧へ戻る",
      }}
    />
  );
}
