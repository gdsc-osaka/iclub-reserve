import { ChevronRight, CircleAlert } from "lucide-react";
import { Link } from "react-router";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  allowedTransitions,
  ReservationTransition,
  type ReservationActor,
} from "~/domain/reservation/transition";
import type { AppArea } from "~/lib/app-area";
import { formatMonthDay, formatTime } from "~/lib/date";
import { toReservationDetailPath } from "~/lib/reservation-paths";
import type { ReservationListItem } from "~/query/reservation/reservation-list";
import { OverlapResolutionDialog } from "./overlap-resolution-dialog";
import { toOverlapPeriodLabel, toOverlapTimeline } from "./overlap-timeline";

export interface ReservationOverlapGroupProps {
  /** まとまりに含まれる仮予約（申請日時の古い順、2 件以上） */
  readonly items: readonly ReservationListItem[];
  readonly actor: ReservationActor;
  readonly area: AppArea;
}

/**
 * 事務局の予約一覧で、重なり合う仮予約を 1 つにまとめたカード（UC-033 / COND-031 (1)）。
 *
 * 見出しに全体の時間帯と「重なりを解決」ボタンを配置し、
 * 中に重なる仮予約の一覧を申請日時の古い順で並べる。
 */
export function ReservationOverlapGroup({
  items,
  actor,
  area,
}: Readonly<ReservationOverlapGroupProps>) {
  const firstItem = items[0];
  if (!firstItem) return null;

  const transitions = allowedTransitions(firstItem, actor);
  const canApprove = transitions.includes(ReservationTransition.Approve);

  const timeline = toOverlapTimeline(items);

  return (
    <li className="flex flex-col overflow-hidden rounded-lg border border-amber-500/30 bg-card">
      {/* 見出しの帯 */}
      <div className="flex flex-col gap-2.5 border-b border-amber-500/20 bg-amber-500/10 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <CircleAlert
              aria-hidden
              className="size-4 shrink-0 text-amber-700 dark:text-amber-400"
            />
            <span className="font-semibold text-sm text-foreground">
              重なる仮予約 {items.length} 件
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {firstItem.facilityName} · {toOverlapPeriodLabel(items)}
          </p>
        </div>

        {canApprove && (
          <OverlapResolutionDialog
            reservationId={firstItem.id}
            trigger={
              <Button size="sm" className="h-8 px-3 text-xs font-medium">
                重なりを解決
              </Button>
            }
          />
        )}
      </div>

      {/* まとまり内の予約行 */}
      <ul className="flex flex-col divide-y divide-border/60">
        {items.map((item, index) => {
          const isFirst = index === 0;
          const bar = timeline.bars.get(item.id);

          return (
            <li
              key={item.id}
              className="group relative flex flex-col justify-between gap-2 p-3.5 transition-colors hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring/50 sm:flex-row sm:items-center sm:gap-4 sm:p-4"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {/* 時間帯・団体名・先着バッジ */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">
                    {formatTime(item.startAt)} – {formatTime(item.endAt)}
                  </span>
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    {item.groupName}
                  </Badge>
                  {isFirst && (
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                      先着
                    </Badge>
                  )}
                </div>

                {/* 使用人数・申請者・申請日時 */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{item.headCount}名</span>
                  <span>申請者: {item.createdByName ?? "不明"}</span>
                  <span>
                    申請日時: {formatMonthDay(item.requestedAt)} {formatTime(item.requestedAt)}
                  </span>
                </div>

                {/* 備考 */}
                {item.note !== null && item.note.trim() !== "" && (
                  <p className="line-clamp-1 text-xs text-muted-foreground">{item.note}</p>
                )}
              </div>

              {/* 帯 */}
              <div className="flex shrink-0 items-center gap-3">
                <div
                  className="relative h-3 w-full rounded-sm bg-muted/50 sm:w-36 md:w-44"
                  aria-hidden
                >
                  {bar && (
                    <div
                      className="absolute top-0 bottom-0 rounded-sm bg-amber-500/70"
                      style={{
                        left: `${bar.leftPercent}%`,
                        width: `${bar.widthPercent}%`,
                      }}
                    />
                  )}
                </div>

                <ChevronRight
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                />
              </div>

              {/*
                カード全面のリンク（ReservationListRow と同じ作り）。
                まとまりの中は日付と施設がどれも同じなので、読み上げで行を見分けられるよう、時間帯と団体名を名前に入れる。
              */}
              <Link
                to={toReservationDetailPath(area, item.id)}
                aria-label={`${formatTime(item.startAt)} – ${formatTime(item.endAt)} ${item.groupName} の予約の詳細を表示`}
                className="absolute inset-0 rounded-lg"
              />
            </li>
          );
        })}
      </ul>
    </li>
  );
}
