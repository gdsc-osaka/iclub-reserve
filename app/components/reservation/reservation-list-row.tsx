import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

import { Badge } from "~/components/ui/badge";
import {
  allowedTransitions,
  ReservationTransition,
  type ReservationActor,
} from "~/domain/reservation/transition";
import {
  formatMonthDay,
  formatMonthDayParts,
  formatTime,
  isSameTokyoDay,
  toTokyoDateKey,
} from "~/lib/date";
import { cn } from "~/lib/utils";
import type { ReservationListItem } from "~/query/reservation/reservation-list";
import { ReservationActionButtons } from "./reservation-action-buttons";
import {
  isEndedReservationStatus,
  reservationOverlapNotice,
  ReservationOverlapNotice,
  ReservationStatusReason,
} from "./reservation-notices";
import { ReservationStatusBadge } from "./reservation-status-badge";

/**
 * 予約一覧の 1 行分コンポーネント。
 *
 * - PC（md 以上）: 横並びの行レイアウト
 * - スマホ: 日時、施設名、ステータス/メタを縦に積むカードレイアウト
 * - タップ可能な要素はすべて 44px 以上のタップ領域を確保する。
 *
 * カード全体が予約詳細へのリンクになっている。中身の無い透明なリンクを
 * カード全面に 1 枚重ねる形で実現していて、リンクはカードに 1 つだけ（下の方を参照）。
 *
 * NOTE: この上に操作ボタン（取り消し・承認など）を足すときは、
 * ボタン側に `relative` を付けて前面に出すこと。付け忘れると、
 * 全面に広がったリンクが手前にいるので、押しても詳細画面へ飛んでしまう。
 */
export function ReservationListRow({
  item,
  showGroupName,
  actor,
  now,
}: Readonly<{
  item: ReservationListItem;
  showGroupName: boolean;
  /**
   * 見ている人。出す操作ボタンはこの人とドメインの判定（allowedTransitions）だけで決まる。
   * 画面側で status を見て分岐させないこと。サーバーが許す操作とすぐにずれる。
   */
  actor: ReservationActor;
  now: Date;
}>) {
  const isEnded = isEndedReservationStatus(item.status);
  const isToday = isSameTokyoDay(item.startAt, now);

  const transitions = allowedTransitions(item, actor);

  const overlapNotice = reservationOverlapNotice({
    status: item.status,
    hasApprovedOverlap: item.hasApprovedOverlap,
    hasProvisionalOverlap: item.hasProvisionalOverlap,
    canApprove: transitions.includes(ReservationTransition.Approve),
  });

  // 日本時間での月日 "9/24" と曜日 "(水)"
  const [_, month, day] = toTokyoDateKey(item.startAt).split("-");
  const monthDayStr = `${Number(month)}/${Number(day)}`;
  const { weekday } = formatMonthDayParts(item.startAt);

  return (
    <li
      className={cn(
        "group relative flex flex-col justify-between gap-3 rounded-lg border p-4 transition-colors md:flex-row md:items-center md:gap-4 md:p-5",
        /*
         * キーボードで送りながら見ている人にも、いまどのカードにいるかが分かるようにする。
         * 中のリンクだけに枠が付いても、カード全体が押せることが伝わらない。
         */
        "focus-within:ring-2 focus-within:ring-ring/50",
        /*
         * ホバー中の色は、終わった予約もそうでない予約も同じ `bg-muted` にそろえる。
         *
         * 背景色は重ね塗りではなく置き換えなので、半透明の色を指定すると
         * 「カードの元の色」ではなく「その後ろにある画面の色」と混ざる。
         * 以前は通常のカードだけ `hover:bg-muted/20` としていたため、
         * 暗いテーマでは通常のカードは暗く、終わったカードは明るくなっていた。
         * 行き先を 1 つに決めておけば、どの状態でも同じ向きに変わる。
         */
        "hover:bg-muted",
        isEnded ? "bg-muted/40" : "bg-card",
      )}
    >
      {/* 1. 日時カラム（幅 104px 程度、縮まない） */}
      <div className="flex shrink-0 flex-row items-center gap-2 md:w-28 md:flex-col md:items-start md:gap-0.5">
        <div className="flex items-center gap-1.5 font-medium">
          <span className="text-base font-semibold">{monthDayStr}</span>
          <span className="text-sm text-muted-foreground">({weekday})</span>
          {isToday && (
            <Badge variant="secondary" className="px-1.5 py-0 text-xs font-normal">
              本日
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground md:text-sm">
          {formatTime(item.startAt)} – {formatTime(item.endAt)}
        </div>
      </div>

      {/* 2. 本文コンテンツ */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* 施設名・バッジ・団体名 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">{item.facilityName}</span>
          <ReservationStatusBadge status={item.status} />
          {showGroupName && (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {item.groupName}
            </Badge>
          )}
        </div>

        {/* 使用人数・申請者名・申請日メタ行 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{item.headCount}名</span>
          <span>申請者: {item.createdByName ?? "不明"}</span>
          <span>申請日: {formatMonthDay(item.createdAt)}</span>
        </div>

        {/* 備考（1〜2 行で省略） */}
        {item.note !== null && item.note.trim() !== "" && (
          <p className="line-clamp-2 text-sm text-muted-foreground">{item.note}</p>
        )}

        {/* 予約の重なりの案内（COND-001 と、仮予約どうしの競合） */}
        <ReservationOverlapNotice notice={overlapNotice} />

        {/* 終了した予約の理由（取り消し・却下・キャンセル） */}
        <ReservationStatusReason status={item.status} reason={item.statusReason} />
      </div>

      {/*
       * 3. 操作ボタン群（前面に出すため relative z-10 を付与）
       */}
      {transitions.length > 0 && (
        <div
          className="relative z-10 flex shrink-0 flex-wrap items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <ReservationActionButtons
            item={item}
            transitions={transitions}
            showGroupName={showGroupName}
          />
        </div>
      )}

      {/*
       * 3. 右端の矢印。押せることを示す目印なので、飾りとして扱う（aria-hidden）。
       * 実際のリンクは下のカード全面のもの 1 つだけ。
       *
       * スマホでは日時の行と同じ高さの右上に浮かせる（absolute）。
       * 縦に積んだレイアウトのまま流し込むと、矢印だけが最下段に 1 行取り残されて、
       * 何を指しているのか分からなくなる。日時の行は短いので、重なることもない。
       */}
      <ChevronRight
        aria-hidden
        className="absolute top-4 right-4 size-5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground md:static md:self-center"
      />

      {/*
       * カード全面を覆う、詳細へのリンク。
       *
       * 中身の無い透明なリンクを 1 枚重ねている。カードの中身ごと `<a>` で包まないのは、
       * 読み上げのときに日時・施設名・状態・備考がすべて 1 つのリンク名として
       * 続けて読まれてしまうため。名前は aria-label だけにする。
       *
       * ボタン（shadcn/ui の Button）を土台にしてはいけない。
       * Button は押している間 `translate-y-px` で沈む作りなので、
       * 押した瞬間にリンク自身が位置の基準になり、広げた当たり判定が
       * ボタンの大きさまで縮む。結果、mouseup が別の要素で起きて
       * クリックが成立しない（リンク先は出るのに移動しない）。
       */}
      <Link
        to={`/reservations/${item.id}`}
        /*
         * どの行のリンクかが読み上げだけで分かるようにする。
         * すべての行が同じ「予約の詳細を表示」だと、読み上げでは
         * 同じ名前のリンクが件数分並ぶことになり、選べない。
         */
        aria-label={`${monthDayStr}(${weekday}) ${item.facilityName} の予約の詳細を表示`}
        className="absolute inset-0 rounded-lg"
      />
    </li>
  );
}
