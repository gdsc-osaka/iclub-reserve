import { FACILITY_CLOSE_HOUR, FACILITY_OPEN_HOUR } from "~/domain/facility";

/**
 * 利用できる時間帯と、日をまたげないことの案内（SCR-002）。
 *
 * 空き状況カレンダーの申請の欄と、予約の変更フォームの両方に出すので、文を 1 か所にまとめる。
 */
export function OperatingHoursNotice() {
  return (
    <p className="text-xs text-muted-foreground">
      利用できるのは {FACILITY_OPEN_HOUR}:00〜{FACILITY_CLOSE_HOUR}:00
      です。日をまたぐ予約はできません。
    </p>
  );
}
