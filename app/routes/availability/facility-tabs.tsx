import { cn } from "cn";
import { Link } from "react-router";

import type { AppArea } from "~/lib/app-area";
import type { AvailabilityFacility } from "~/query/facility/facility-availability-calendar";

import { toCalendarPath, type CalendarSelection } from "./paths";

/**
 * 施設・設備の切り替え。
 *
 * 選ぶたびにサーバーへ取り直すので、プルダウンではなくリンクにしている。
 * リンクなら JavaScript が動いていなくても切り替えられ、
 * 「この施設のこの週」をそのまま人に送れる。
 * 基準の日を持ち回り、仮の枠を開いているときはその仮の枠を引き継ぐ（ADR-014 決定 14）。
 * 「同じ時間に別の部屋は空いているか」を、入力し直さずに見比べられるようにするため。
 * 変更を開いているときも、変更と変更後の仮の枠を引き継ぐ。切り替えた先の施設が変更後の施設になる（ADR-014 決定 15）。
 * 予約を開いているときは外す（予約はその施設のものなので、別の施設のカレンダーには出せない）。
 */
export function FacilityTabs({
  facilities,
  current,
  anchorKey,
  selection,
  area,
}: Readonly<{
  facilities: readonly AvailabilityFacility[];
  current: AvailabilityFacility;
  anchorKey: string;
  selection: CalendarSelection | null;
  area: AppArea;
}>) {
  const carriedSelection =
    selection === null || selection.kind === "reservation" ? undefined : selection;

  return (
    <nav
      aria-label="施設・設備の切り替え"
      className="-mx-4 shrink-0 overflow-x-auto px-4 md:mx-0 md:px-0"
    >
      <ul className="flex w-max gap-2">
        {facilities.map((item) => {
          const isCurrent = item.id === current.id;

          return (
            <li key={item.id}>
              <Link
                to={toCalendarPath(area, item.id, anchorKey, carriedSelection)}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  "inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                  isCurrent
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent",
                )}
              >
                {item.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
