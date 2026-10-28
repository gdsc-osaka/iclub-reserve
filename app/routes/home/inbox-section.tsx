import { cn } from "cn";
import {
  CalendarClock,
  CalendarPlus,
  CalendarX2,
  Check,
  CircleCheck,
  CircleX,
  KeyRound,
  Mail,
  MessageSquareText,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, useFetcher } from "react-router";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { membershipRoleLabel } from "~/domain/membership";
import { GroupUnreadEventType } from "~/domain/reservation";
import { unlockArrangementLabel } from "~/domain/reservation/unlock-arrangement";
import { AppArea } from "~/lib/app-area";
import { formatMonthDay, formatRelativeTime, formatTimeRange } from "~/lib/date";
import { toFormPathForFacility, toReservationDetailPath } from "~/lib/reservation-paths";
import type { UserInvitationItem } from "~/query/group/user-invitations";
import type { GroupUnreadUpdateItem } from "~/query/reservation/group-unread-updates";
import { HomeIntent, type HomeActionData } from "./home-intent";
import { SectionUnavailableAlert } from "./section-unavailable-alert";

/** 出来事の種類ごとの見せ方（COND-026 (2) の出来事） */
const eventView: Record<
  GroupUnreadEventType,
  { readonly title: string; readonly icon: LucideIcon; readonly tone: "primary" | "destructive" }
> = {
  [GroupUnreadEventType.Message]: {
    title: "事務局からメッセージが届いています",
    icon: MessageSquareText,
    tone: "primary",
  },
  [GroupUnreadEventType.Approve]: {
    title: "仮予約が承認されました",
    icon: CircleCheck,
    tone: "primary",
  },
  [GroupUnreadEventType.Reject]: {
    title: "仮予約が却下されました",
    icon: CircleX,
    tone: "destructive",
  },
  [GroupUnreadEventType.StaffCancel]: {
    title: "事務局が予約をキャンセルしました",
    icon: CalendarX2,
    tone: "destructive",
  },
  [GroupUnreadEventType.DirectCreate]: {
    title: "事務局が予約を作成しました",
    icon: CalendarPlus,
    tone: "primary",
  },
  [GroupUnreadEventType.DirectChange]: {
    title: "事務局が予約を変更しました",
    icon: CalendarClock,
    tone: "primary",
  },
  [GroupUnreadEventType.UnlockArrangementUpdate]: {
    title: "解錠の手配が更新されました",
    icon: KeyRound,
    tone: "primary",
  },
};

const toneClass = {
  primary: "bg-primary/10 text-primary",
  destructive: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-foreground",
} as const;

/** fetcher の結果から、利用者に見せる失敗の文言を取り出す */
const formErrorOf = (data: HomeActionData | undefined): string | null =>
  data !== undefined && "formError" in data ? data.formError : null;

/** 行の左に出す、種類ごとの丸いアイコン */
function EventIcon({
  icon: Icon,
  tone,
}: Readonly<{ icon: LucideIcon; tone: keyof typeof toneClass }>) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full",
        toneClass[tone],
      )}
    >
      <Icon aria-hidden className="size-4" />
    </span>
  );
}

/**
 * 行の本文（題名・相対時刻・どこの話か・抜粋）。押すと詳細へ移る。
 */
function RowBody({
  to,
  title,
  time,
  where,
  quote,
}: Readonly<{ to: string; title: string; time: string; where: string; quote: string | null }>) {
  return (
    <Link
      to={to}
      className="group flex min-w-0 flex-1 flex-col gap-1 rounded-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="font-semibold underline-offset-4 group-hover:underline">{title}</span>
        <span className="text-xs text-muted-foreground">{time}</span>
      </span>
      <span className="text-sm text-muted-foreground">{where}</span>
      {quote && (
        <span className="block truncate rounded-md bg-muted px-2.5 py-2 text-sm text-muted-foreground">
          {quote}
        </span>
      )}
    </Link>
  );
}

/** 行の下に出す、操作の失敗の案内 */
function RowError({ message }: Readonly<{ message: string | null }>) {
  if (message === null) return null;
  return (
    <p role="alert" className="text-sm text-destructive sm:pl-12">
      {message}
    </p>
  );
}

/** 未読の予約 1 件分の行（COND-026 (1)） */
function UnreadReservationRow({ item, now }: Readonly<{ item: GroupUnreadUpdateItem; now: Date }>) {
  const fetcher = useFetcher<HomeActionData>();

  /*
   * 押した直後から行を消す。成功すれば、読み直した一覧からもこの行は消えている。
   * 失敗したときは、行を戻して理由を出す。
   */
  if (fetcher.state !== "idle") return null;

  const view = eventView[item.latestEvent.type];
  const { latestEvent } = item;
  const quote =
    latestEvent.type === GroupUnreadEventType.Message
      ? (latestEvent.messageBody ?? null)
      : latestEvent.type === GroupUnreadEventType.Reject ||
          latestEvent.type === GroupUnreadEventType.StaffCancel
        ? (latestEvent.statusReason ?? null)
        : null;
  const baseTitle =
    latestEvent.type === GroupUnreadEventType.UnlockArrangementUpdate &&
    latestEvent.unlockArrangement
      ? `解錠の手配が「${unlockArrangementLabel[latestEvent.unlockArrangement]}」に更新されました`
      : view.title;
  const title = item.otherCount > 0 ? `${baseTitle}（ほか ${item.otherCount} 件）` : baseTitle;
  const where = `${item.groupName}・${item.facilityName}・${formatMonthDay(item.startAt)} ${formatTimeRange(item.startAt, item.endAt)}`;

  return (
    <li className="flex flex-col gap-2 border-t px-4 py-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <EventIcon icon={view.icon} tone={view.tone} />
          <RowBody
            to={toReservationDetailPath(AppArea.User, item.reservationId)}
            title={title}
            time={formatRelativeTime(latestEvent.eventAt, now)}
            where={where}
            quote={quote}
          />
        </div>

        <div className="grid shrink-0 auto-cols-fr grid-flow-col gap-2 sm:flex sm:justify-end">
          {latestEvent.type === GroupUnreadEventType.Reject && (
            <Button asChild variant="outline" className="h-9 sm:h-8">
              <Link to={toFormPathForFacility(AppArea.User, item.facilityId)}>別の日時で申請</Link>
            </Button>
          )}
          <fetcher.Form method="post" className="contents">
            <input type="hidden" name="intent" value={HomeIntent.MarkRead} />
            <input type="hidden" name="reservationId" value={item.reservationId} />
            <Button type="submit" variant="ghost" className="h-9 sm:h-8">
              <Check aria-hidden />
              確認済み
            </Button>
          </fetcher.Form>
        </div>
      </div>
      <RowError message={formErrorOf(fetcher.data)} />
    </li>
  );
}

/** 自分宛ての招待 1 件分の行（UC-022） */
function InvitationRow({
  invitation,
  now,
}: Readonly<{ invitation: UserInvitationItem; now: Date }>) {
  const fetcher = useFetcher<HomeActionData>();
  const [isRejectDialogOpen, setRejectDialogOpen] = useState(false);

  // 承諾・辞退を押した直後から行を消す。失敗したときは行を戻して理由を出す
  if (fetcher.state !== "idle") return null;

  const roleLabel = membershipRoleLabel[invitation.role];

  const submit = (intent: HomeIntent) => {
    void fetcher.submit({ intent, invitationId: invitation.id }, { method: "post" });
  };

  return (
    <li className="flex flex-col gap-2 border-t px-4 py-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <EventIcon icon={Mail} tone="neutral" />
          <RowBody
            to={`/invitations/${invitation.id}`}
            title="団体への招待"
            time={formatRelativeTime(invitation.createdAt, now)}
            where={`${invitation.groupName}・${roleLabel}として・期限 ${formatMonthDay(invitation.expiresAt)}`}
            quote={null}
          />
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:justify-end">
          {/* 辞退すると二度と承諾できないので、確認を挟む（招待の画面と同じ） */}
          <AlertDialog open={isRejectDialogOpen} onOpenChange={setRejectDialogOpen}>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" className="h-9 sm:h-8">
                辞退
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>招待を辞退しますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  「{invitation.groupName}
                  」への招待を辞退します。辞退した招待は、あとから承諾できません。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel type="button">やめる</AlertDialogCancel>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    setRejectDialogOpen(false);
                    submit(HomeIntent.RejectInvitation);
                  }}
                >
                  辞退する
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            type="button"
            className="h-9 sm:h-8"
            onClick={() => submit(HomeIntent.AcceptInvitation)}
          >
            承諾
          </Button>
        </div>
      </div>
      <RowError message={formErrorOf(fetcher.data)} />
    </li>
  );
}

export interface InboxSectionProps {
  /** 未読のある予約（新しい順・最大 10 件） */
  readonly unreadReservations: readonly GroupUnreadUpdateItem[];
  /** 10 件を超えた分の予約の件数 */
  readonly overflowCount: number;
  readonly invitations: readonly UserInvitationItem[];
  /** 未読か招待を読めなかったとき */
  readonly isUnavailable: boolean;
  readonly now: Date;
}

/**
 * ダッシュボードの「確認が必要なこと」区画（SCR-022 / UC-037）。
 *
 * 相手側のまだ見ていない動き（COND-026）と、承諾待ちの自分宛ての招待（UC-022）を並べる。
 * 招待は「確認済み」では消さず、承諾・辞退するか期限が切れるまで出し続ける。
 */
export function InboxSection({
  unreadReservations,
  overflowCount,
  invitations,
  isUnavailable,
  now,
}: InboxSectionProps) {
  const markAllFetcher = useFetcher<HomeActionData>();

  // 「すべて確認済みにする」を送っている間は、予約の行をまとめて消しておく
  const reservations = markAllFetcher.state === "idle" ? unreadReservations : [];
  const reservationCount =
    reservations.length + (markAllFetcher.state === "idle" ? overflowCount : 0);
  const totalCount = reservationCount + invitations.length;

  const markAllRead = () => {
    // 押したときに一覧に出ていた予約だけを送る（「ほか n 件」は残す）
    const formData = new FormData();
    formData.set("intent", HomeIntent.MarkAllRead);
    for (const item of reservations) {
      formData.append("reservationId", item.reservationId);
    }
    void markAllFetcher.submit(formData, { method: "post" });
  };

  return (
    <section aria-labelledby="inbox-title" className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5">
        <div className="flex flex-col gap-0.5">
          <h2 id="inbox-title" className="flex items-center gap-2 font-semibold">
            確認が必要なこと
            {totalCount > 0 && (
              <span className="inline-flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                {totalCount}
              </span>
            )}
          </h2>
        </div>
        {reservations.length > 0 && (
          <Button type="button" variant="ghost" className="h-9 sm:h-8" onClick={markAllRead}>
            すべて確認済みにする
          </Button>
        )}
      </div>

      {isUnavailable && (
        <div className="border-t px-4 py-3.5">
          <SectionUnavailableAlert what="確認が必要なこと" />
        </div>
      )}

      {formErrorOf(markAllFetcher.data) !== null && (
        <p role="alert" className="border-t px-4 py-3 text-sm text-destructive">
          {formErrorOf(markAllFetcher.data)}
        </p>
      )}

      {totalCount === 0 && !isUnavailable && (
        <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground">
          確認が必要なことはありません
        </p>
      )}

      {(invitations.length > 0 || reservations.length > 0) && (
        <ul>
          {invitations.map((invitation) => (
            <InvitationRow key={invitation.id} invitation={invitation} now={now} />
          ))}
          {reservations.map((item) => (
            <UnreadReservationRow key={item.reservationId} item={item} now={now} />
          ))}
        </ul>
      )}

      {reservations.length > 0 && overflowCount > 0 && (
        <p className="border-t px-4 py-3 text-center text-xs text-muted-foreground">
          ほかに {overflowCount} 件あります。上の予約を確認すると、続きが表示されます。
        </p>
      )}
    </section>
  );
}
