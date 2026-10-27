import {
  CalendarPlus,
  ChevronLeft,
  CircleAlert,
  PersonStanding,
  StickyNote,
  User,
  Users,
} from "lucide-react";
import { isRouteErrorResponse, Link } from "react-router";

import { InfoItem } from "~/components/info-item";
import { ReservationMessageSection } from "~/components/reservation/message/reservation-message-section";
import { ReservationActionButtons } from "~/components/reservation/reservation-action-buttons";
import {
  reservationOverlapNotice,
  ReservationOverlapNotice,
  ReservationStatusReason,
} from "~/components/reservation/reservation-notices";
import { ReservationStatusBadge } from "~/components/reservation/reservation-status-badge";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ReservationTransition } from "~/domain/reservation/transition";
import type { AppArea } from "~/lib/app-area";
import { formatDateTime, formatFullDate, formatTimeRange } from "~/lib/date";
import { toReservationEditPath } from "~/lib/reservation-paths";
import {
  toReservationListPath,
  toReservationListScope,
} from "~/routes/reservations/list/query-params";

import { ReservationAuditLogCard } from "./reservation-audit-log-card";
import type { loadReservationDetail } from "./reservation-detail.server";

export type ReservationDetailLoaderData = Awaited<ReturnType<typeof loadReservationDetail>>;

export function ReservationDetailPage({
  loaderData,
  actionData,
}: {
  readonly loaderData: ReservationDetailLoaderData;
  readonly actionData?: { readonly formError?: string | null };
}) {
  const { view, transitions, canEdit, listPath, area } = loaderData;
  const { reservation } = view;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <div>
        <Link
          to={listPath}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-4" />
          予約一覧へ戻る
        </Link>
      </div>

      {/* 施設・日時・状態は誰にでも見せる項目（COND-008）なので、見出しにまとめる */}
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">{reservation.facilityName}</h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>
            {formatFullDate(reservation.startAt)}{" "}
            {formatTimeRange(reservation.startAt, reservation.endAt)}
          </span>
          <ReservationStatusBadge status={reservation.status} />
        </div>
      </div>

      {actionData?.formError && (
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>操作に失敗しました</AlertTitle>
          <AlertDescription>{actionData.formError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">予約内容</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-5 sm:grid-cols-2">
            <InfoItem icon={Users} label="団体">
              {reservation.groupName}
            </InfoItem>
            {view.canViewDetail && (
              <>
                <InfoItem icon={PersonStanding} label="使用人数">
                  {view.reservation.headCount}名
                </InfoItem>
                <InfoItem icon={User} label="申請者">
                  {view.reservation.createdByName ?? "不明"}
                </InfoItem>
                <InfoItem icon={CalendarPlus} label="申請日時">
                  {formatDateTime(view.reservation.requestedAt)}
                  {/*
                   * 施設・日時を変えて申し込み直した予約には、最初に申請した日時も添える。
                   * 申請日時だけだと、「先に申請したのに後ろに並んでいる」理由が分からない。
                   */}
                  {view.reservation.requestedAt.getTime() !==
                    view.reservation.createdAt.getTime() && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      最初の申請: {formatDateTime(view.reservation.createdAt)}
                      （施設・日時を変更して申請し直し）
                    </span>
                  )}
                </InfoItem>
                <InfoItem icon={StickyNote} label="備考" className="sm:col-span-2">
                  <span className="font-normal whitespace-pre-wrap">
                    {view.reservation.note !== null && view.reservation.note.trim() !== ""
                      ? view.reservation.note
                      : "なし"}
                  </span>
                </InfoItem>
              </>
            )}
          </dl>

          {view.canViewDetail ? (
            <ReservationStatusReason
              status={view.reservation.status}
              reason={view.reservation.statusReason}
              className="mt-0"
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              他の団体の予約のため、公開されている項目（団体名・施設・日時・状態）だけを表示しています。
            </p>
          )}
        </CardContent>
      </Card>

      {view.canViewDetail && (
        <>
          <ReservationOverlapNotice
            className="mt-0"
            notice={reservationOverlapNotice({
              status: view.reservation.status,
              hasApprovedOverlap: view.reservation.hasApprovedOverlap,
              hasProvisionalOverlap: view.reservation.hasProvisionalOverlap,
              canApprove: transitions.includes(ReservationTransition.Approve),
            })}
          />

          {(transitions.length > 0 || canEdit) && (
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && (
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 text-xs font-medium"
                >
                  <Link to={toReservationEditPath(area, view.reservation.id)}>変更</Link>
                </Button>
              )}
              <ReservationActionButtons
                item={view.reservation}
                transitions={transitions}
                showGroupName
              />
            </div>
          )}

          {/* メッセージ欄。他団体の人には欄ごと出さない（COND-008） */}
          <ReservationMessageSection messages={view.messages} />

          {/* 操作履歴欄。他団体の人には欄ごと出さない（COND-008 / COND-012） */}
          <ReservationAuditLogCard auditLogs={view.auditLogs} />
        </>
      )}
    </main>
  );
}

/**
 * 例外発生時の ErrorBoundary。
 *
 * 404（存在しない、または権限がない予約）およびその他のエラーを日本語で案内する。
 * 戻り先は、開いていた画面の予約一覧にする（ADR-016 決定 15）。
 */
export function ReservationDetailErrorBoundary({
  error,
  area,
}: Readonly<{ error: unknown; area: AppArea }>) {
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;
  const listPath = toReservationListPath({}, toReservationListScope(area));

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">
            {isNotFound ? "予約が見つかりません" : "予約を表示できません"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            {isNotFound
              ? "予約が見つからないか、表示する権限がありません。"
              : "時間をおいて、もう一度お試しください。"}
          </p>
          <Link to={listPath} className="text-primary underline underline-offset-4">
            予約一覧へ戻る
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
