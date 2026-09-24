import { env } from "cloudflare:workers";
import { ChevronLeft, CircleAlert, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import { isRouteErrorResponse, Link, redirect } from "react-router";

import { ReservationActionButtons } from "~/components/reservation/reservation-action-buttons";
import {
  reservationOverlapNotice,
  ReservationOverlapNotice,
  ReservationStatusReason,
} from "~/components/reservation/reservation-notices";
import { ReservationStatusBadge } from "~/components/reservation/reservation-status-badge";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { parseReservationTransition, ReservationTransition } from "~/domain/reservation/transition";
import { createDb } from "~/infra/db";
import { createQueueMailOutboxNotifier } from "~/infra/mail/mail-queue.server";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationDetailQuery } from "~/infra/reservation/reservation-detail-query";
import { createReservationMailRecipientsQuery } from "~/infra/reservation/reservation-mail-recipients-query";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { formatDateTime, formatFullDate, formatTimeRange } from "~/lib/date";
import {
  reservationActionErrors,
  reservationErrorResponse,
} from "~/routes/_shared/reservation-error.server";
import { changeReservationStatusUseCase } from "~/usecases/reservation/change-reservation-status";
import { getReservationUseCase } from "~/usecases/reservation/get-reservation";
import type { Route } from "./+types/route";

export function meta() {
  return [{ title: "予約の詳細 | iclub-reserve" }];
}

/**
 * 予約詳細画面（SCR-005）のローダー。
 *
 * 見ている人に見せてよい範囲まで絞った予約と、実行可能な状態変更操作を返す（COND-008）。
 * 他団体の予約では、使用人数・備考・却下/キャンセル理由・作成者が
 * ユースケースの時点で落ちている。画面側で隠すのではないので、
 * 通信の中身を見ても読めない。
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  // この画面はログイン必須（root.tsx のミドルウェアが先に確認している）
  const user = requireRequestUser(context);
  const db = createDb(env.DB);

  const result = await getReservationUseCase(
    {
      reservationDetailQuery: createReservationDetailQuery(db),
      membershipRepository: createMembershipRepository(db),
    },
    {
      reservationId: params.reservationId,
      actorUserId: user.id,
      isStaff: user.is_staff,
    },
  );

  if (result.isErr()) {
    // 見られない予約も、無い予約と同じ 404 になる。揃えるのは表の側
    throw reservationErrorResponse(
      { where: "reservations.detail.loader", userId: user.id },
      result.error,
    );
  }

  const listPath = user.is_staff ? "/staff/reservations" : "/reservations";

  return {
    ...result.value,
    listPath,
  };
}

/**
 * 予約詳細画面からの状態変更アクション（取り消し・キャンセル・承認・却下・事務局キャンセル）。
 */
export async function action({ request, params, context }: Route.ActionArgs) {
  const user = requireRequestUser(context);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const reason = formData.get("reason");
  /*
   * 予約 ID はフォームの値ではなく URL から取る。ダイアログは一覧と共有していて
   * reservationId も送ってくるが、そちらを信じると、この画面から別の予約を操作できてしまう。
   */
  const reservationId = params.reservationId;

  const transition = parseReservationTransition(intent);
  if (transition === null) {
    return { formError: "不正な操作です。" };
  }

  /*
   * 一覧と違い、isStaffTransition で受け付ける操作を絞らない。この画面は団体と事務局の
   * 両方が開き、事務局の人がその団体のメンバーを兼ねていれば両方の操作が並ぶため。
   * 操作の可否はユースケースの canTransition が見る。
   */
  const db = createDb(env.DB);
  const result = await changeReservationStatusUseCase(
    {
      reservationRepository: createReservationRepository(db),
      membershipRepository: createMembershipRepository(db),
      reservationMailRecipientsQuery: createReservationMailRecipientsQuery(db),
      mailOutboxNotifier: createQueueMailOutboxNotifier(),
    },
    {
      reservationId,
      actorUserId: user.id,
      isStaff: user.is_staff,
      transition,
      reason: typeof reason === "string" ? reason : null,
      now: new Date(),
    },
  );

  if (result.isErr()) {
    return reservationActionErrors(
      { where: `reservations.detail.${transition}`, userId: user.id },
      result.error,
    );
  }

  return redirect(".");
}

export default function ReservationDetailRoute({ loaderData, actionData }: Route.ComponentProps) {
  const { view, transitions, listPath } = loaderData;
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
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <DetailItem label="団体">{reservation.groupName}</DetailItem>
            {view.canViewDetail && (
              <>
                <DetailItem label="使用人数">{view.reservation.headCount}名</DetailItem>
                <DetailItem label="申請者">{view.reservation.createdByName ?? "不明"}</DetailItem>
                <DetailItem label="申請日時">
                  {formatDateTime(view.reservation.createdAt)}
                </DetailItem>
                <DetailItem label="備考" className="sm:col-span-2">
                  <span className="font-normal whitespace-pre-wrap">
                    {view.reservation.note !== null && view.reservation.note.trim() !== ""
                      ? view.reservation.note
                      : "なし"}
                  </span>
                </DetailItem>
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

          {transitions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <ReservationActionButtons
                item={view.reservation}
                transitions={transitions}
                showGroupName
              />
            </div>
          )}

          {/*
           * メッセージ欄。他団体の人には欄ごと出さない（COND-008）。
           * NOTE: メッセージ（UC-009 / INFO-004）は未実装。テーブルを作ったらこの欄を置き換える
           */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">メッセージ</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                <MessageSquare aria-hidden className="size-4 shrink-0" />
                メッセージ機能は準備中です。
              </div>
            </CardContent>
          </Card>

          {/* NOTE: 操作履歴（UC-024 / UC-025 / COND-012）は INFO-008 が未実装のため欄を置いていない */}
        </>
      )}
    </main>
  );
}

/** 予約内容の 1 項目（見出しと値） */
function DetailItem({
  label,
  className,
  children,
}: Readonly<{ label: string; className?: string; children: ReactNode }>) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

/**
 * 例外発生時の ErrorBoundary。
 *
 * 404（存在しない、または権限がない予約）およびその他のエラーを日本語で案内する。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

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
              ? "予約が存在しないか、表示できません。"
              : "時間をおいて、もう一度お試しください。"}
          </p>
          <Link to="/reservations" className="text-primary underline underline-offset-4">
            予約一覧へ戻る
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
