import { env } from "cloudflare:workers";
import { redirect, type RouterContextProvider } from "react-router";

import { createDb } from "~/infra/db";
import { createGroupRepository } from "~/infra/group/group-repo";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import type { AppArea } from "~/lib/app-area";
import { toTokyoDateKey } from "~/lib/date";
import { requireAreaUser, toAreaWhere } from "~/routes/_shared/app-area.server";
import { reservationErrorResponse } from "~/routes/_shared/reservation-error.server";
import { toCalendarPath, toReservationDraft } from "~/routes/availability/paths";
import { getReservationEditFormUseCase } from "~/usecases/reservation/get-reservation-edit-form";

export interface LoadReservationEditEntryArgs {
  readonly context: Readonly<RouterContextProvider>;
  readonly reservationId: string;
}

/**
 * 予約の変更の入口（UC-005 / UC-017 / ADR-014 決定 15）。利用者の画面と事務局の画面のルートが、
 * どちらの画面かを渡して呼ぶ（ADR-016 決定 10）。
 *
 * 画面は持たず、変更できるかを確かめてから、その予約の施設と日を開いた
 * 空き状況カレンダーの変更の欄へ転送する。予約一覧（SCR-003）と予約詳細（SCR-005）の
 * 「変更」からカレンダーの変更欄を直接開けるようにするため。
 * 事務局の画面からは直接変更（UC-008）、利用者の画面からは団体の変更として確かめる（COND-030 の (2)）。
 *
 * 変更できない予約（他団体・終了済み・開始後）は、ユースケースが断ってエラー画面になる。
 * 断る理由と status は reservation-error.server.ts の表が決める。
 */
export async function loadReservationEditEntry(args: LoadReservationEditEntryArgs, area: AppArea) {
  const where = toAreaWhere(area, "reservations.edit.loader");
  const { user, actsAsStaff } = await requireAreaUser(args.context, area, where);
  const reservationId = args.reservationId;
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
      isStaff: actsAsStaff,
      now,
    },
  );

  if (result.isErr()) {
    throw reservationErrorResponse({ where, userId: user.id }, result.error);
  }

  const { reservation } = result.value;
  const dateKey = toTokyoDateKey(reservation.startAt);

  throw redirect(
    toCalendarPath(area, reservation.facilityId, dateKey, {
      kind: "edit",
      reservationId,
      draft: toReservationDraft(reservation),
    }),
  );
}
