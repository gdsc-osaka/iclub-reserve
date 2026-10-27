import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import { ReservationEditError } from "~/components/reservation/reservation-edit-error";
import { createDb } from "~/infra/db";
import { createGroupRepository } from "~/infra/group/group-repo";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { toTokyoDateKey } from "~/lib/date";
import { reservationErrorResponse } from "~/routes/_shared/reservation-error.server";
import { toCalendarPath, toReservationDraft } from "~/routes/availability/paths";
import { getReservationEditFormUseCase } from "~/usecases/reservation/get-reservation-edit-form";

import type { Route } from "./+types/route";

export function meta() {
  return [{ title: "予約の変更 | i-Club 予約システム" }];
}

/**
 * 予約の変更の入口（UC-005 / UC-017 / ADR-014 決定 15）。
 *
 * 画面は持たず、変更できるかを確かめてから、その予約の施設と日を開いた
 * 空き状況カレンダーの変更の欄へ転送する。予約一覧（SCR-003）と予約詳細（SCR-005）の
 * 「変更」からカレンダーの変更欄を直接開けるようにするため。
 *
 * 変更できない予約（他団体・終了済み・開始後）は、ユースケースが断ってエラー画面になる。
 * 断る理由と status は reservation-error.server.ts の表が決める。
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);
  const reservationId = params.reservationId;
  const now = new Date();
  const db = createDb(env.DB);

  const result = await getReservationEditFormUseCase(
    {
      reservationRepository: createReservationRepository(db),
      membershipRepository: createMembershipRepository(db),
      groupRepository: createGroupRepository(db),
    },
    {
      reservationId,
      actorUserId: user.id,
      isStaff: user.is_staff,
      now,
    },
  );

  if (result.isErr()) {
    throw reservationErrorResponse(
      { where: "reservations.edit.loader", userId: user.id },
      result.error,
    );
  }

  const { reservation } = result.value;
  const dateKey = toTokyoDateKey(reservation.startAt);

  throw redirect(
    toCalendarPath(reservation.facilityId, dateKey, {
      kind: "edit",
      reservationId,
      draft: toReservationDraft(reservation),
    }),
  );
}

/**
 * 外枠（app-layout）の下の画面として扱われるようにするための default コンポーネント。
 *
 * React Router は default のコンポーネントが無いルートを resource route（データだけを返すルート）
 * として扱うため、外枠の共通レイアウトが適用されなくなる。
 * ローダーで常に転送されるためこの画面が描画されることはないが、ほかの画面と同じ扱いのルートとして残す。
 */
export default function EditReservation() {
  return null;
}

/**
 * このルートで例外が起きたときに出す画面。変更できない理由は、空き状況カレンダーの変更の欄と同じ画面で出す。
 */
export function ErrorBoundary({ error, params }: Route.ErrorBoundaryProps) {
  return (
    <ReservationEditError
      error={error}
      reservationId={params.reservationId}
      backLink={{ to: "/reservations", label: "予約一覧へ戻る" }}
    />
  );
}
