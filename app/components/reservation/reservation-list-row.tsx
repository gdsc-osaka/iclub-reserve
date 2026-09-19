import { ChevronRight, CircleAlert } from "lucide-react";
import { Link } from "react-router";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  canTransition,
  ReservationStatus,
  ReservationTransition,
  type ReservationActor,
} from "~/domain/reservation";
import {
  formatMonthDay,
  formatMonthDayParts,
  formatTime,
  isSameTokyoDay,
  toTokyoDateKey,
} from "~/lib/date";
import { cn } from "~/lib/utils";
import type { ReservationListItem } from "~/query/reservation/reservation-list";
import { ReservationActionDialog } from "./reservation-action-dialog";
import { ReservationStatusBadge } from "./reservation-status-badge";

const isEndedStatus = (status: ReservationStatus): boolean =>
  status === ReservationStatus.Withdrawn ||
  status === ReservationStatus.Rejected ||
  status === ReservationStatus.Cancelled ||
  status === ReservationStatus.CancelledByStaff;

const isDestructiveReason = (status: ReservationStatus): boolean =>
  status === ReservationStatus.Rejected || status === ReservationStatus.CancelledByStaff;

/**
 * 理由欄の見出し。
 *
 * 状態ごとに呼び名を変える。取り消し（団体が承認前に取り下げた）と
 * キャンセル（承認後に取りやめた）は別のことなので、同じ見出しにすると
 * どちらが起きたのか分からなくなる。
 */
const reasonLabel = (status: ReservationStatus): string => {
  switch (status) {
    case ReservationStatus.Rejected:
      return "却下理由: ";
    case ReservationStatus.CancelledByStaff:
      return "事務局キャンセル理由: ";
    case ReservationStatus.Withdrawn:
      return "取り消し理由: ";
    default:
      return "キャンセル理由: ";
  }
};

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
   * 見ている人。出す操作ボタンはこの人とドメインの判定（canTransition）だけで決まる。
   * 画面側で status を見て分岐させないこと。サーバーが許す操作とすぐにずれる。
   */
  actor: ReservationActor;
  now: Date;
}>) {
  const isEnded = isEndedStatus(item.status);
  const isToday = isSameTokyoDay(item.startAt, now);

  const canWithdraw = canTransition(item, ReservationTransition.Withdraw, actor).isOk();
  const canCancel = canTransition(item, ReservationTransition.Cancel, actor).isOk();
  const canApprove = canTransition(item, ReservationTransition.Approve, actor).isOk();
  const canReject = canTransition(item, ReservationTransition.Reject, actor).isOk();
  const canStaffCancel = canTransition(item, ReservationTransition.StaffCancel, actor).isOk();

  const hasActions = canWithdraw || canCancel || canApprove || canReject || canStaffCancel;

  /*
   * 重なりの案内は仮予約にだけ出す。承認するかどうかを決める場面と、
   * 自分の申請が通るかどうかを気にする場面が、どちらも仮予約のときだから。
   *
   * 承認済みとの重なりは承認できない（COND-001）。他の仮予約との重なりは
   * 承認を止めないが、先に承認された方だけが残るので、その旨を伝える。
   */
  const isProvisional = item.status === ReservationStatus.Provisional;
  const overlapsApproved = isProvisional && (item.hasApprovedOverlap ?? false);
  const overlapsProvisional = isProvisional && (item.hasProvisionalOverlap ?? false);
  const isOverlapBlocked = canApprove && overlapsApproved;

  const overlapNotice = overlapsApproved
    ? canApprove
      ? "同一時間帯に承認済みの予約があるため承認できません"
      : "同じ時間帯に承認済みの予約があります。この申請は承認されない場合があります"
    : overlapsProvisional
      ? "同じ時間帯に他の仮予約があります。承認されるのはどちらか一方です"
      : null;

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
        {overlapNotice !== null && (
          <div className="mt-1 flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-300">
            <CircleAlert className="size-3.5 shrink-0" />
            <span>{overlapNotice}</span>
          </div>
        )}

        {/*
         * 終了した予約の理由表示（取り消し・却下・キャンセル）。
         *
         * 終了していない予約では出さない。`statusReason` は却下・キャンセルの理由を入れる欄なので
         * （INFO-001 / COND-002）、承認済みの予約に値が入っていても理由ではない。
         * 状態を見ずに中身があるかどうかだけで出すと、承認済みの行に
         * 「キャンセル理由」という見出しが付いてしまう。
         */}
        {isEnded && item.statusReason !== null && item.statusReason.trim() !== "" && (
          <div
            className={cn(
              "mt-1 rounded-md border px-2.5 py-2 text-sm",
              isDestructiveReason(item.status)
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-border bg-muted/60 text-muted-foreground",
            )}
          >
            <span className="font-medium">{reasonLabel(item.status)}</span>
            {item.statusReason}
          </div>
        )}
      </div>

      {/*
       * 3. 操作ボタン群（前面に出すため relative z-10 を付与）
       */}
      {hasActions && (
        <div
          className="relative z-10 flex shrink-0 flex-wrap items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {canApprove && (
            <ReservationActionDialog
              item={item}
              transition={ReservationTransition.Approve}
              showGroupName={showGroupName}
              disabled={isOverlapBlocked}
              trigger={
                <Button
                  size="sm"
                  variant="default"
                  disabled={isOverlapBlocked}
                  className="h-8 px-3 text-xs font-medium"
                >
                  承認
                </Button>
              }
            />
          )}
          {canReject && (
            <ReservationActionDialog
              item={item}
              transition={ReservationTransition.Reject}
              showGroupName={showGroupName}
              trigger={
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-destructive/40 px-3 text-xs font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  却下
                </Button>
              }
            />
          )}
          {canWithdraw && (
            <ReservationActionDialog
              item={item}
              transition={ReservationTransition.Withdraw}
              showGroupName={showGroupName}
              trigger={
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-destructive/40 px-3 text-xs font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  取り消し
                </Button>
              }
            />
          )}
          {(canCancel || canStaffCancel) && (
            <ReservationActionDialog
              item={item}
              transition={
                canCancel ? ReservationTransition.Cancel : ReservationTransition.StaffCancel
              }
              showGroupName={showGroupName}
              trigger={
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-destructive/40 px-3 text-xs font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  キャンセル
                </Button>
              }
            />
          )}
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
