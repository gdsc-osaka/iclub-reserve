import { Activity, Clock } from "lucide-react";
import { Link } from "react-router";

import { Badge } from "~/components/ui/badge";
import {
  AuditLogTargetType,
  auditLogActionLabel,
  auditLogTargetTypeLabel,
} from "~/domain/audit-log";
import { formatMonthDayParts, formatRelativeTime, formatTime } from "~/lib/date";
import type { GroupRecentActivityView } from "~/usecases/audit-log/get-group-recent-activities";
import { SectionUnavailableAlert } from "./section-unavailable-alert";

export interface RecentActivitySectionProps {
  readonly activities: readonly GroupRecentActivityView[];
  readonly isUnavailable: boolean;
  readonly now: Date;
}

/**
 * ダッシュボード「団体の最近の動き」区画（SCR-022 / UC-025）。
 *
 * 所属団体の操作履歴（直近 7 日・新しい順に最大 5 件）を表示する。
 * 開示範囲は COND-012 に従い、本人の操作と、予約に対する事務局の横断権限操作は除く。
 */
export function RecentActivitySection({
  activities,
  isUnavailable,
  now,
}: Readonly<RecentActivitySectionProps>) {
  return (
    <section aria-labelledby="recent-activity-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="recent-activity-title" className="flex items-center gap-2 font-semibold">
          <Activity aria-hidden className="size-4.5 text-muted-foreground" />
          団体の最近の動き
        </h2>
        <p className="text-xs text-muted-foreground">同じ団体のメンバーの操作（直近 7 日）</p>
      </div>

      {isUnavailable && <SectionUnavailableAlert what="団体の最近の動き" />}

      {activities.length === 0 && !isUnavailable && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card p-6 text-center">
          <p className="text-sm font-medium">最近の動きはありません</p>
        </div>
      )}

      {activities.length > 0 && (
        <ul className="flex flex-col divide-y rounded-xl border bg-card overflow-hidden">
          {activities.map((item) => (
            <RecentActivityRow key={item.id} item={item} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** 1 件分の操作履歴行 */
function RecentActivityRow({
  item,
  now,
}: Readonly<{
  item: GroupRecentActivityView;
  now: Date;
}>) {
  const actorName =
    item.actor.kind === "staff" ? "事務局" : (item.actor.name ?? "（削除されたユーザー）");

  const actionLabel = auditLogActionLabel[item.action];
  const targetTypeLabel = auditLogTargetTypeLabel[item.targetType];
  // 予約の記録は予約詳細へ、それ以外（管理者にだけ出る団体・メンバーシップ・招待）は団体管理画面へ
  const targetUrl =
    item.targetType === AuditLogTargetType.Reservation
      ? `/reservations/${item.targetId}`
      : `/groups/${item.groupId}`;

  return (
    <li className="group relative flex flex-col gap-1.5 p-3.5 transition-colors hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring/50">
      <Link
        to={targetUrl}
        className="absolute inset-0 z-0"
        aria-label={`${actorName}・${targetTypeLabel}の${actionLabel}（${item.groupName}）`}
      />

      {/* ヘッダー行: 操作者・対象の種類・操作名・相対時刻。並びは操作履歴の一覧（AuditLogEntryList）にそろえる */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-foreground">{actorName}</span>
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            {targetTypeLabel}
          </Badge>
          <span className="font-semibold text-foreground">{actionLabel}</span>
        </div>

        <time
          dateTime={item.occurredAt.toISOString()}
          className="shrink-0 text-muted-foreground flex items-center gap-1 text-[11px]"
        >
          <Clock aria-hidden className="size-3" />
          {formatRelativeTime(item.occurredAt, now)}
        </time>
      </div>

      {/* 対象の概要行: 団体名・施設・日時 */}
      <div className="text-xs text-muted-foreground truncate">
        <span className="font-medium text-foreground">{item.groupName}</span>
        {item.reservation !== null && (
          <>
            <span className="mx-1">·</span>
            <span>{item.reservation.facilityName}</span>
            <span className="mx-1">·</span>
            <span>
              {formatMonthDayParts(item.reservation.startAt).monthDay}{" "}
              {formatTime(item.reservation.startAt)}〜{formatTime(item.reservation.endAt)}
            </span>
          </>
        )}
      </div>
    </li>
  );
}
