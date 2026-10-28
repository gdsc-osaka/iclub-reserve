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
 * カレンダーの見出しの左に出す、施設・設備の選択欄。押すとプルダウンで施設・設備を切り替えられる（ADR-014 決定 17）。
 *
 * 施設を横に並べたボタンにすると、施設が増えるほど 1 行を取り、スマホではカレンダーの高さを削ってしまう。
 * いま見ている施設の名前はもともと見出しに出しているので、そこを切り替えの入口にする。
 *
 * 見た目は、枠で囲んで右端に ▼ を置き、フォームの選択欄にそろえる（ADR-014 決定 20）。
 * 枠の無い文字だけだと見出しにしか見えず、ここで施設を選べることに気づけない。
 * PC では左に「施設・設備」と添える。スマホは幅が足りず、施設名が切れてしまうので添えない。
 * まだ施設を選んでいないときは、施設名の代わりに「施設・設備を選択」と出す。
 *
 * プルダウンの項目は、ボタンではなくリンクにしている。
 * 選ぶたびにサーバーへ取り直すので、リンクなら「この施設のこの週」をそのまま人に送れ、別のタブでも開ける。
 * 基準の日と、`carriedSelection`（仮の枠・変更）を持ち回る（ADR-014 決定 14・15）。
 * 「同じ時間に別の部屋は空いているか」を、入力し直さずに見比べられるようにするため。
 *
 * 施設・設備が 1 つしか無いときは、選ぶものが無いので名前だけを出す。
 */
export function FacilityMenu({
  facilities,
  current,
  anchorKey,
  carriedSelection,
  area,
}: Readonly<{
  facilities: readonly AvailabilityFacility[];
  /** いま見ている施設・設備。まだ選んでいなければ null */
  current: AvailabilityFacility | null;
  anchorKey: string;
  /** 切り替えた先へ引き継ぐもの。無ければ undefined */
  carriedSelection: CalendarSelection | undefined;
  area: AppArea;
}>) {
  if (facilities.length <= 1 && current !== null) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <CalendarDays aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{current.name}</span>
      </span>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      {/* 読み上げでは、ボタンの名前に「施設・設備を選んで切り替え」を含めているので読ませない */}
      {current !== null && (
        <span
          aria-hidden
          className="hidden shrink-0 text-sm font-normal text-muted-foreground md:inline"
        >
          施設・設備
        </span>
      )}

      <DropdownMenu>
        {/* まだ選んでいないときは、枠を目立たせて選ぶ場所を示す */}
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={
              current === null
                ? "min-w-0 justify-between border-primary/60 dark:border-primary/60"
                : "min-w-0 justify-between"
            }
          >
            {current === null ? (
              <span className="truncate text-muted-foreground">施設・設備を選択</span>
            ) : (
              <>
                <span className="truncate">{current.name}</span>
                <span className="sr-only">（施設・設備を選んで切り替え）</span>
              </>
            )}
            <ChevronDown aria-hidden className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>

        {/* 施設名が選択欄より長くても切れないよう、幅は選択欄に合わせず項目に合わせる */}
        <DropdownMenuContent
          align="start"
          className="w-auto min-w-(--radix-dropdown-menu-trigger-width) max-w-[calc(100vw-2rem)]"
        >
          {facilities.map((item) => {
            const isCurrent = item.id === current?.id;

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
    </span>
  );
}
