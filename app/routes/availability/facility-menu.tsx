import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { AppArea } from "~/lib/app-area";
import type { AvailabilityFacility } from "~/query/facility/facility-availability-calendar";

import { toCalendarPath, type CalendarSelection } from "./paths";

/**
 * カレンダーの見出しの左に出す施設・設備の名前。押すとプルダウンで施設・設備を切り替えられる（ADR-014 決定 17）。
 *
 * 施設を横に並べたボタンにすると、施設が増えるほど 1 行を取り、スマホではカレンダーの高さを削ってしまう。
 * いま見ている施設の名前はもともと見出しに出しているので、そこを切り替えの入口にする。
 *
 * プルダウンの項目は、ボタンではなくリンクにしている。
 * 選ぶたびにサーバーへ取り直すので、リンクなら「この施設のこの週」をそのまま人に送れ、別のタブでも開ける。
 * 基準の日を持ち回り、仮の枠を開いているときはその仮の枠を引き継ぐ（ADR-014 決定 14）。
 * 「同じ時間に別の部屋は空いているか」を、入力し直さずに見比べられるようにするため。
 * 変更を開いているときも、変更と変更後の仮の枠を引き継ぐ。切り替えた先の施設が変更後の施設になる（ADR-014 決定 15）。
 * 予約を開いているときは外す（予約はその施設のものなので、別の施設のカレンダーには出せない）。
 *
 * 施設・設備が 1 つしか無いときは、選ぶものが無いので名前だけを出す。
 */
export function FacilityMenu({
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
  if (facilities.length <= 1) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <CalendarDays aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{current.name}</span>
      </span>
    );
  }

  const carriedSelection =
    selection === null || selection.kind === "reservation" ? undefined : selection;

  return (
    <DropdownMenu>
      {/* 文字の左端を、見出しの帯の余白にそろえる。ボタンの左の余白のぶんだけ左へずらす */}
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" className="-ml-2.5 min-w-0 shrink text-base">
          <CalendarDays aria-hidden className="text-muted-foreground" />
          <span className="truncate">{current.name}</span>
          <ChevronDown aria-hidden className="text-muted-foreground" />
          <span className="sr-only">（施設・設備を選んで切り替え）</span>
        </Button>
      </DropdownMenuTrigger>

      {/* 施設名が見出しのボタンより長くても切れないよう、幅はボタンに合わせず項目に合わせる */}
      <DropdownMenuContent
        align="start"
        className="w-auto min-w-(--radix-dropdown-menu-trigger-width) max-w-[calc(100vw-2rem)]"
      >
        {facilities.map((item) => {
          const isCurrent = item.id === current.id;

          return (
            <DropdownMenuItem key={item.id} asChild>
              <Link
                to={toCalendarPath(area, item.id, anchorKey, carriedSelection)}
                aria-current={isCurrent ? "page" : undefined}
              >
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <Check aria-hidden className={isCurrent ? undefined : "invisible"} />
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
