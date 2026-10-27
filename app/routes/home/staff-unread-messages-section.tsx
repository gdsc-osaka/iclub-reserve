import { Check, CornerDownLeft, MessageSquareText } from "lucide-react";
import { Link, useFetcher } from "react-router";

import { Button } from "~/components/ui/button";
import { reservationDetailPath } from "~/domain/reservation";
import { formatMonthDay, formatRelativeTime, formatTimeRange } from "~/lib/date";
import type { StaffUnreadMessageItem } from "~/query/reservation/staff-unread-messages";
import { HomeIntent, type HomeActionData } from "./home-intent";
import { STAFF_UNREAD_SECTION_ID } from "./staff-tiles-section";
import { SectionUnavailableAlert } from "./section-unavailable-alert";

/** 予約詳細のメッセージ欄へ移るパス。欄の id は `reservation-message-section.tsx` に置いている */
const toMessagesPath = (reservationId: string) =>
  `${reservationDetailPath(reservationId)}#messages`;

export interface StaffUnreadMessagesSectionProps {
  readonly items: readonly StaffUnreadMessageItem[];
  readonly overflowCount: number;
  readonly isUnavailable: boolean;
  readonly now: Date;
}

/**
 * 事務局のダッシュボードの「団体からの未読メッセージ」（SCR-022 / UC-037 / COND-026 (3)）。
 *
 * 事務局の誰かが返信または承認などをすると、全員の一覧から消える。
 * 「確認済み」を押したときは、押した本人の一覧からだけ消える。
 */
export function StaffUnreadMessagesSection({
  items,
  overflowCount,
  isUnavailable,
  now,
}: Readonly<StaffUnreadMessagesSectionProps>) {
  return (
    <section
      id={STAFF_UNREAD_SECTION_ID}
      aria-labelledby="staff-unread-title"
      className="flex flex-col gap-3 scroll-mt-6"
    >
      <div>
        <h2 id="staff-unread-title" className="flex items-center gap-2 font-semibold">
          <MessageSquareText aria-hidden className="size-4.5 text-muted-foreground" />
          団体からの未読メッセージ
        </h2>
        <p className="text-xs text-muted-foreground">
          事務局の誰かが返信または承認などをすると、全員の一覧から消えます
        </p>
      </div>

      {isUnavailable && <SectionUnavailableAlert what="未読メッセージ" forStaff />}

      {items.length === 0 && !isUnavailable && (
        <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          未読のメッセージはありません
        </p>
      )}

      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col divide-y rounded-xl border bg-card overflow-hidden">
            {items.map((item) => (
              <StaffUnreadMessageRow key={item.reservationId} item={item} now={now} />
            ))}
          </ul>

          {overflowCount > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              ほかに {overflowCount} 件あります。上の予約を確認すると、続きが表示されます。
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** 団体からの未読メッセージ 1 件分の行 */
function StaffUnreadMessageRow({
  item,
  now,
}: Readonly<{
  item: StaffUnreadMessageItem;
  now: Date;
}>) {
  const fetcher = useFetcher<HomeActionData>();

  /*
   * 「確認済み」を送ったら、結果を待たずに行を消す。
   * 成功すれば読み直した一覧からも消える。失敗したときは行を戻して、理由を出す。
   */
  if (fetcher.state !== "idle") return null;

  const formError =
    fetcher.data !== undefined && "formError" in fetcher.data ? fetcher.data.formError : null;

  const timeStr = `${formatMonthDay(item.startAt)} ${formatTimeRange(item.startAt, item.endAt)}`;
  const relativeTime = formatRelativeTime(item.latestMessage.sentAt, now);

  return (
    <li className="flex flex-col gap-2 p-3.5 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* 本文。押すと予約詳細のメッセージ欄へ移る（開くと既読になる。COND-026 (5)） */}
        <Link
          to={toMessagesPath(item.reservationId)}
          className="group flex min-w-0 flex-1 flex-col gap-1 rounded-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="font-semibold underline-offset-4 group-hover:underline">
              {item.groupName}
            </span>
            <span className="text-xs text-muted-foreground">{relativeTime}</span>
            {item.otherCount > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                ほか {item.otherCount} 件
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {item.facilityName} · {timeStr}
          </span>
          <span className="mt-1 block truncate rounded-md bg-muted px-2.5 py-2 text-sm text-muted-foreground">
            {item.latestMessage.body}
          </span>
        </Link>

        {/* 操作ボタン: スマホでは 2 列全幅、PC では横並び */}
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void fetcher.submit(
                { intent: HomeIntent.MarkRead, reservationId: item.reservationId },
                { method: "post" },
              );
            }}
            className="h-9"
          >
            <Check aria-hidden className="mr-1.5 size-3.5" />
            確認済み
          </Button>

          <Button asChild size="sm" className="h-9">
            <Link to={toMessagesPath(item.reservationId)}>
              <CornerDownLeft aria-hidden className="mr-1.5 size-3.5" />
              返信する
            </Link>
          </Button>
        </div>
      </div>

      {formError && (
        <p role="alert" className="text-xs text-destructive">
          {formError}
        </p>
      )}
    </li>
  );
}
