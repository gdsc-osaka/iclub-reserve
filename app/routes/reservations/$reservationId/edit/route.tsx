import { env } from "cloudflare:workers";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { isRouteErrorResponse, Link, redirect } from "react-router";

import {
  fieldKeyOf,
  parseReservationContent,
  readValues,
  toFormErrors,
} from "~/components/reservation/editor/form-values";
import { ReservationEditorForm } from "~/components/reservation/editor/reservation-editor-form";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  ReservationEditMode,
  ReservationEditOutcome,
  resolveEditMode,
} from "~/domain/reservation/edit";
import { createDb } from "~/infra/db";
import { createFacilityRepository } from "~/infra/facility/facility-repo";
import { createGroupRepository } from "~/infra/group/group-repo";
import { createQueueMailOutboxNotifier } from "~/infra/mail/mail-queue.server";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationFormQuery } from "~/infra/reservation/reservation-form-query";
import { createReservationMailRecipientsQuery } from "~/infra/reservation/reservation-mail-recipients-query";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import { createUserGroupListQuery } from "~/infra/user/user-group-list-query";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { toTokyoDateKey, tokyoMinutesOfDay } from "~/lib/date";
import { toReservationDetailPath } from "~/lib/reservation-paths";
import type { ReservationFormFacility } from "~/query/reservation/reservation-form";
import {
  reservationActionErrors,
  reservationErrorResponse,
} from "~/routes/_shared/reservation-error.server";
import { editReservationUseCase } from "~/usecases/reservation/edit-reservation";
import { editReservationDirectlyUseCase } from "~/usecases/reservation/edit-reservation-directly";
import { getReservationEditFormUseCase } from "~/usecases/reservation/get-reservation-edit-form";

import type { Route } from "./+types/route";

export function meta() {
  return [{ title: "予約の変更 | iclub-reserve" }];
}

/**
 * 最初に出す施設を 1 件選ぶ。
 *
 * URL の `facility` は、日付を動かしたときに `DateNavigation` が選んでいた施設を載せたもの。
 * 再読み込みしても選び直した施設に戻れるよう、選択肢にあればそちらを優先する。
 * 無い・壊れているときは予約の施設に戻す（申請フォームと違い、先頭に飛ばすと施設を勝手に変えてしまう）。
 */
const pickFacilityId = (
  facilities: readonly ReservationFormFacility[],
  requested: string | null,
  fallback: string,
): string =>
  facilities.find((facility) => facility.id === requested)?.id ??
  facilities.find((facility) => facility.id === fallback)?.id ??
  facilities.at(0)?.id ??
  "";

/**
 * 予約の変更画面（UC-005 / UC-017）のローダー。
 *
 * 施設と日付は申請フォームと同じく URL のクエリで受け取る。
 * クエリが無い・壊れているときは予約の開始日（日本時間）を出す。
 *
 * 変更できない予約（他団体・終了済み・開始後）は、ユースケースが断ってエラー画面になる。
 * 断る理由と status は `reservation-error.server.ts` の表が決める。
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);
  const reservationId = params.reservationId;
  const url = new URL(request.url);
  const now = new Date();
  const db = createDb(env.DB);

  const result = await getReservationEditFormUseCase(
    {
      reservationRepository: createReservationRepository(db),
      membershipRepository: createMembershipRepository(db),
      groupRepository: createGroupRepository(db),
      reservationFormQuery: createReservationFormQuery(db),
      userGroupListQuery: createUserGroupListQuery(db),
    },
    {
      reservationId,
      actorUserId: user.id,
      isStaff: user.is_staff,
      dateKey: url.searchParams.get("date"),
      now,
    },
  );

  if (result.isErr()) {
    throw reservationErrorResponse(
      { where: "reservations.edit.loader", userId: user.id },
      result.error,
    );
  }

  const data = result.value;

  const facilityId = pickFacilityId(
    data.facilities,
    url.searchParams.get("facility"),
    data.reservation.facilityId,
  );

  return {
    reservation: data.reservation,
    facilities: data.facilities,
    reservations: data.reservations,
    now,
    todayKey: toTokyoDateKey(now),
    isDirect: data.isDirect,
    initial: {
      facilityId,
      dateKey: toTokyoDateKey(data.selectedDay),
      startMinutes: tokyoMinutesOfDay(data.reservation.startAt),
      endMinutes: tokyoMinutesOfDay(data.reservation.endAt),
      headCount: String(data.reservation.headCount),
      note: data.reservation.note ?? "",
    },
  };
}

/**
 * 予約の内容を変更する（UC-005 / UC-008 / UC-017）。
 *
 * 予約 ID はフォームの値ではなく URL から取る。フォームの値を信じると、
 * この画面から別の予約を書き換えられてしまう。
 *
 * 成功したら予約詳細へ転送する。送信の結果をそのまま描くと、再読み込みが再送信になる。
 */
export async function action({ request, params, context }: Route.ActionArgs) {
  const user = requireRequestUser(context);
  const reservationId = params.reservationId;

  const formData = await request.formData();
  const values = readValues(formData);
  const now = new Date();

  const { content, fieldErrors } = parseReservationContent(values, now);

  if (content === null) {
    return { values, fieldErrors, formError: null };
  }

  const db = createDb(env.DB);
  const deps = {
    reservationRepository: createReservationRepository(db),
    membershipRepository: createMembershipRepository(db),
    facilityRepository: createFacilityRepository(db),
    reservationMailRecipientsQuery: createReservationMailRecipientsQuery(db),
    mailOutboxNotifier: createQueueMailOutboxNotifier(),
  };
  const args = {
    reservationId,
    actorUserId: user.id,
    isStaff: user.is_staff,
    now,
    content,
  };

  const result =
    resolveEditMode(args) === ReservationEditMode.Direct
      ? await editReservationDirectlyUseCase(deps, args)
      : await editReservationUseCase(deps, args);

  if (result.isErr()) {
    return {
      values,
      ...toFormErrors(
        reservationActionErrors(
          { where: "reservations.edit.action", userId: user.id },
          result.error,
          fieldKeyOf,
        ),
      ),
    };
  }

  // 何も変わらなかったときも成功だが、保存していないことは伝える（詳細画面の案内を参照）
  const outcomeParam =
    result.value.outcome === ReservationEditOutcome.NoChange ? "unchanged" : "changed";

  throw redirect(toReservationDetailPath(reservationId, { edited: outcomeParam }));
}

/** 予約の変更画面（UC-005 / UC-008 / UC-017）。フォームの本体は申請と共有している */
export default function EditReservation({ loaderData, actionData }: Route.ComponentProps) {
  const { reservation, facilities, reservations, now, todayKey, initial, isDirect } = loaderData;

  return (
    <PageShell reservationId={reservation.id}>
      <ReservationEditorForm
        purpose={{
          kind: "edit",
          reservation,
          isDirect,
        }}
        facilities={facilities}
        reservations={reservations}
        now={now}
        todayKey={todayKey}
        initial={initial}
        actionData={actionData ?? null}
      />
    </PageShell>
  );
}

/** 見出しと戻る導線。どの状態でも同じ位置に出す */
function PageShell({
  reservationId,
  children,
}: Readonly<{
  reservationId: string;
  children: ReactNode;
}>) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-2">
        <div>
          <Link
            to={toReservationDetailPath(reservationId)}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft aria-hidden className="size-4" />
            予約の詳細へ戻る
          </Link>
        </div>
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">予約の変更</h1>
      </div>
      {children}
    </main>
  );
}

/**
 * このルートで例外が起きたときに出す画面。
 *
 * ローダーが投げた応答には、エラーの表が決めた文言（`data.message`）が入っている。
 * 変更できない理由（権限が無い・終了した・状態が変わった）はそれで伝わるので、ここで書き分けない。
 */
export function ErrorBoundary({ error, params }: Route.ErrorBoundaryProps) {
  const isResponse = isRouteErrorResponse(error);
  const isNotFound = isResponse && error.status === 404;
  const reservationId = params.reservationId;

  const errorMessage =
    isResponse && typeof error.data === "object" && error.data !== null && "message" in error.data
      ? String(error.data.message)
      : isNotFound
        ? "予約が存在しないか、表示できません。"
        : "この予約は変更できません。時間をおいて、もう一度お試しください。";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">
            <h1 className="text-xl font-bold">
              {isNotFound ? "予約が見つかりません" : "この予約は変更できません"}
            </h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">{errorMessage}</p>
          <div className="flex flex-wrap items-center gap-4">
            {reservationId && (
              <Link
                to={toReservationDetailPath(reservationId)}
                className="text-primary underline underline-offset-4"
              >
                予約の詳細へ戻る
              </Link>
            )}
            <Link to="/reservations" className="text-primary underline underline-offset-4">
              予約一覧へ戻る
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
