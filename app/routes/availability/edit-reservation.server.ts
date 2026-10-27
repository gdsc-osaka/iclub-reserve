import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import {
  fieldKeyOf,
  parseReservationContent,
  readValues,
  toFormErrors,
} from "~/components/reservation/editor/form-values";
import { ReservationEditMode, resolveEditMode } from "~/domain/reservation/edit";
import { createDb } from "~/infra/db";
import { createFacilityRepository } from "~/infra/facility/facility-repo";
import { createQueueMailOutboxNotifier } from "~/infra/mail/mail-queue.server";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationMailRecipientsQuery } from "~/infra/reservation/reservation-mail-recipients-query";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import { resolveAppBaseUrl } from "~/lib/app-url.server";
import type { SessionUser } from "~/lib/auth/auth-session.server";
import { reservationActionErrors } from "~/routes/_shared/reservation-error.server";
import { editReservationUseCase } from "~/usecases/reservation/edit-reservation";
import { editReservationDirectlyUseCase } from "~/usecases/reservation/edit-reservation-directly";

import { EDIT_RESERVATION_INTENT, type EditReservationActionError } from "./availability-edit-form";
import { parseCalendarSelection, resolveAnchorDateKey, toCalendarPath } from "./paths";

/**
 * 空き状況カレンダーの変更の欄から予約の内容を変更する（UC-005 / UC-008 / UC-017 / ADR-014 決定 15）。
 *
 * 予約 ID はフォームの値ではなく URL から取る。フォームの値を信じると、
 * この画面から別の予約を書き換えられてしまうため（ローダーが読んで欄に出した予約と同じものを指す）。
 *
 * 成功したら、変更した予約を欄に開く URL へ転送する（ADR-014 決定 10・15）。
 * 送信の結果をそのまま描くと、再読み込みが再送信になってしまう。
 */
export async function editReservationAction({
  request,
  formData,
  user,
}: {
  request: Request;
  formData: FormData;
  user: SessionUser;
}): Promise<EditReservationActionError> {
  const values = readValues(formData);
  const now = new Date();

  const selection = parseCalendarSelection(new URL(request.url).searchParams);
  if (selection?.kind !== "edit") {
    return {
      intent: EDIT_RESERVATION_INTENT,
      values,
      fieldErrors: {},
      formError: "予約が指定されていません。",
    };
  }
  const reservationId = selection.reservationId;

  const { content, fieldErrors } = parseReservationContent(values, now);

  if (content === null) {
    return {
      intent: EDIT_RESERVATION_INTENT,
      values,
      fieldErrors,
      formError: null,
    };
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
    appBaseUrl: resolveAppBaseUrl(request),
  };

  const isDirect = resolveEditMode(args) === ReservationEditMode.Direct;
  const result = isDirect
    ? await editReservationDirectlyUseCase(deps, {
        ...args,
        unlockArrangement: values.unlockArrangement,
      })
    : await editReservationUseCase(deps, args);

  if (result.isErr()) {
    return {
      intent: EDIT_RESERVATION_INTENT,
      values,
      ...toFormErrors(
        reservationActionErrors(
          { where: "availability.edit", userId: user.id },
          result.error,
          fieldKeyOf,
        ),
      ),
    };
  }

  /*
   * 成功したら、変更した予約を欄に開く URL へ転送する（ADR-014 決定 15）。
   * 基準の日は、送ってきた URL（request.url）の date が日付として読めればそれ、読めなければ変更後の日。
   */
  const anchorDateKey = resolveAnchorDateKey(request.url, values.dateKey);

  throw redirect(
    toCalendarPath(content.facilityId, anchorDateKey, {
      kind: "reservation",
      reservationId,
    }),
  );
}
