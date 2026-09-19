import { Link } from "react-router";

import { cn } from "~/lib/utils";
import type { AvailabilityFacility } from "~/query/facility/facility-availability-calendar";

import { toCalendarPath } from "./paths";

/**
 * 施設・設備の切り替え。
 *
 * 選ぶたびにサーバーへ取り直すので、プルダウンではなくリンクにしている。
 * リンクなら JavaScript が動いていなくても切り替えられ、
 * 「この施設のこの週」をそのまま人に送れる。
 */
export function FacilityTabs({
  facilities,
  current,
  weekStart,
}: Readonly<{
  facilities: readonly AvailabilityFacility[];
  current: AvailabilityFacility;
  weekStart: Date;
}>) {
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
                to={toCalendarPath(item.id, weekStart)}
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
