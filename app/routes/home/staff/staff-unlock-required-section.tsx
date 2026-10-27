import { ChevronRight, KeyRound } from "lucide-react";
import { Link } from "react-router";

import { AppArea } from "~/lib/app-area";
import { formatMonthDay, formatTimeRange } from "~/lib/date";
import { toReservationDetailPath } from "~/lib/reservation-paths";
import type { StaffUnlockRequiredReservationItem } from "~/query/reservation/staff-unlock-required-reservations";
import { SectionUnavailableAlert } from "../section-unavailable-alert";
import { STAFF_UNLOCK_REQUIRED_SECTION_ID } from "./staff-tiles-section";

export interface StaffUnlockRequiredSectionProps {
  /** 開始日時の近い順に最大 5 件 */
  readonly reservations: readonly StaffUnlockRequiredReservationItem[];
  /** 解錠の手配が要る予約の総数（5 件を超えた分も含む） */
  readonly totalCount: number;
  readonly isUnavailable: boolean;
}

/**
 * 事務局のダッシュボードの「解錠の手配が要る予約」（SCR-022 (4) / COND-027 (4)）。
 *
 * 利用日が近いものから先に手配できるよう、開始日時の近い順に並べる。
 * 行を選ぶと事務局の画面の予約詳細（SCR-005）が開き、手配の状況を変更できる。
 * 詳細を開くと既読が進むため、リンクには先読み（prefetch）を付けない。
 */
export function StaffUnlockRequiredSection({
  reservations,
  totalCount,
  isUnavailable,
}: Readonly<StaffUnlockRequiredSectionProps>) {
  const overflowCount = Math.max(0, totalCount - reservations.length);

  return (
    <section
      id={STAFF_UNLOCK_REQUIRED_SECTION_ID}
      aria-labelledby="staff-unlock-required-title"
      className="flex flex-col gap-3 scroll-mt-6"
    >
      <div>
        <h2 id="staff-unlock-required-title" className="flex items-center gap-2 font-semibold">
          <KeyRound aria-hidden className="size-4.5 text-muted-foreground" />
          解錠の手配が要る予約
        </h2>
        <p className="text-xs text-muted-foreground">利用日が近い順</p>
      </div>

      {isUnavailable && <SectionUnavailableAlert what="解錠の手配が要る予約" forStaff />}

      {!isUnavailable && reservations.length === 0 && (
        <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          解錠の手配が要る予約はありません
        </p>
      )}

      {reservations.length > 0 && (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
            {reservations.map((item) => (
              <li key={item.id}>
                <Link
                  to={toReservationDetailPath(AppArea.Staff, item.id)}
                  className="flex items-center gap-3 p-3.5 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring sm:p-4"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-semibold">
                      {formatMonthDay(item.startAt)} {formatTimeRange(item.startAt, item.endAt)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {item.facilityName} · {item.groupName}
                    </span>
                  </div>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>

          {overflowCount > 0 && (
            <p className="text-center text-xs text-muted-foreground">ほか {overflowCount} 件</p>
          )}
        </div>
      )}
    </section>
  );
}
