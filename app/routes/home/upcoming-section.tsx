import { Calendar, ChevronRight, MessageSquare } from "lucide-react";
import { Link } from "react-router";

import { ReservationStatusBadge } from "~/components/reservation/reservation-status-badge";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { formatDaysUntil, formatMonthDay, formatMonthDayParts, formatTime } from "~/lib/date";
import type { ReservationListItem } from "~/query/reservation/reservation-list";
import { SectionUnavailableAlert } from "./section-unavailable-alert";

export interface UpcomingSectionProps {
  readonly reservations: readonly ReservationListItem[];
  /** 団体側の未読がある予約（COND-026）。「確認が必要なこと」に出ている予約に、メッセージのアイコンを付ける */
  readonly unreadReservationIds: ReadonlySet<string>;
  readonly isUnavailable: boolean;
  readonly now: Date;
}

/**
 * ダッシュボード「今後の予約」区画（SCR-022 / UC-032）。
 *
 * 利用者が所属する全団体の終了していない予約を開始日時順に最大 5 件表示する。
 * 先頭の 1 件を「次の予約」として大きく目立たせ、残りは行として並べる。
 */
export function UpcomingSection({
  reservations,
  unreadReservationIds,
  isUnavailable,
  now,
}: Readonly<UpcomingSectionProps>) {
  const first = reservations[0] ?? null;
  const rest = reservations.slice(1);

  return (
    <section aria-labelledby="upcoming-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="upcoming-title" className="flex items-center gap-2 font-semibold">
          <Calendar aria-hidden className="size-4.5 text-muted-foreground" />
          今後の予約
        </h2>
        <Button asChild variant="ghost" size="sm" className="h-8 text-xs">
          <Link to="/reservations">予約一覧へ</Link>
        </Button>
      </div>

      {isUnavailable && <SectionUnavailableAlert what="今後の予約" />}

      {reservations.length === 0 && !isUnavailable && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card p-6 text-center">
          <p className="text-sm font-medium">今後の予約はありません</p>
          <p className="mt-1 text-xs text-muted-foreground">
            申請フォームで施設と日付を選ぶと、その日の空き状況を確かめて申請できます。
          </p>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link to="/reservations/new">予約を申請</Link>
          </Button>
        </div>
      )}

      {first !== null && (
        <div className="flex flex-col gap-3">
          {/* 先頭の 1 件: 「次の予約」として大きく表示 */}
          <NextReservationCard
            item={first}
            hasUnread={unreadReservationIds.has(first.id)}
            now={now}
          />

          {/* 残りの予約を行で表示 */}
          {rest.length > 0 && (
            <ul className="flex flex-col divide-y rounded-xl border bg-card overflow-hidden">
              {rest.map((item) => (
                <UpcomingReservationRow
                  key={item.id}
                  item={item}
                  hasUnread={unreadReservationIds.has(item.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** 先頭の「次の予約」カード */
function NextReservationCard({
  item,
  hasUnread,
  now,
}: Readonly<{
  item: ReservationListItem;
  hasUnread: boolean;
  now: Date;
}>) {
  const daysLabel = formatDaysUntil(item.startAt, now);
  const isHighlightDay = daysLabel === "今日" || daysLabel === "明日";

  return (
    <Card className="relative overflow-hidden transition-colors hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring/50">
      <Link
        to={`/reservations/${item.id}`}
        className="absolute inset-0 z-0"
        aria-label={`次の予約の詳細を開く: ${item.facilityName} ${item.groupName}`}
      />
      <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge
              variant={isHighlightDay ? "default" : "secondary"}
              className="px-2 py-0.5 text-xs font-semibold"
            >
              {daysLabel}
            </Badge>
            <span className="text-xs text-muted-foreground">次の予約</span>
          </div>
          <div className="flex items-center gap-2">
            {hasUnread && (
              <span
                className="flex items-center gap-1 text-xs text-primary"
                title="確認が必要なことがあります"
              >
                <MessageSquare aria-hidden className="size-3.5 fill-primary/20" />
                <span className="sr-only">確認が必要なことがあります</span>
              </span>
            )}
            <ReservationStatusBadge status={item.status} />
          </div>
        </div>

        <div>
          <div className="text-lg font-bold sm:text-xl">
            {formatMonthDay(item.startAt)}{" "}
            <span className="text-base font-semibold sm:text-lg">
              {formatTime(item.startAt)}〜{formatTime(item.endAt)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{item.facilityName}</span>
            <span>·</span>
            <span>{item.groupName}</span>
            <span>·</span>
            <span>{item.headCount} 人</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** 2 件目以降の予約行 */
function UpcomingReservationRow({
  item,
  hasUnread,
}: Readonly<{
  item: ReservationListItem;
  hasUnread: boolean;
}>) {
  const { monthDay, weekday } = formatMonthDayParts(item.startAt);

  return (
    <li className="group relative flex flex-col justify-between gap-2 p-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-3 focus-within:ring-2 focus-within:ring-ring/50">
      <Link
        to={`/reservations/${item.id}`}
        className="absolute inset-0 z-0"
        aria-label={`予約詳細を開く: ${item.facilityName} ${item.groupName}`}
      />

      {/* 日時 */}
      <div className="flex items-center gap-2 sm:w-48 sm:shrink-0">
        <span className="text-sm font-semibold">
          {monthDay}
          <span className="text-xs text-muted-foreground">（{weekday}）</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {formatTime(item.startAt)}〜{formatTime(item.endAt)}
        </span>
      </div>

      {/* 施設名・団体名 */}
      <div className="flex min-w-0 flex-1 items-center gap-2 text-xs sm:text-sm">
        <span className="truncate font-medium text-foreground">{item.facilityName}</span>
        <span className="text-muted-foreground">·</span>
        <span className="truncate text-muted-foreground">{item.groupName}</span>
      </div>

      {/* バッジ・アイコン */}
      <div className="flex shrink-0 items-center gap-2">
        {hasUnread && (
          <span className="text-primary" title="確認が必要なことがあります">
            <MessageSquare aria-hidden className="size-4 fill-primary/20" />
            <span className="sr-only">確認が必要なことがあります</span>
          </span>
        )}
        <ReservationStatusBadge status={item.status} />
        <ChevronRight
          aria-hidden
          className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </div>
    </li>
  );
}
