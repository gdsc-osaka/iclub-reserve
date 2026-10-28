import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import {
  fieldKeyOf,
  parseReservation,
  readValues,
  toFormErrors,
} from "~/components/reservation/editor/form-values";
import { createDb } from "~/infra/db";
import { createFacilityRepository } from "~/infra/facility/facility-repo";
import { createGroupRepository } from "~/infra/group/group-repo";
import { createQueueMailOutboxNotifier } from "~/infra/mail/mail-queue.server";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationMailRecipientsQuery } from "~/infra/reservation/reservation-mail-recipients-query";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import type { AppArea } from "~/lib/app-area";
import { resolveAppBaseUrl } from "~/lib/app-url.server";
import type { SessionUser } from "~/lib/auth/auth-session.server";
import { reservationActionErrors } from "~/routes/_shared/reservation-error.server";
import { createDirectReservationUseCase } from "~/usecases/reservation/create-direct-reservation";
import { createProvisionalReservationUseCase } from "~/usecases/reservation/create-reservation";

import {
  CREATE_RESERVATION_INTENT,
  type CreateReservationActionError,
} from "./availability-draft-form";
import { resolveAnchorDateKey, toCalendarPath } from "./paths";

/**
 * 空き状況カレンダーの仮の枠から仮予約を申請する（UC-002）か、事務局が承認済みの予約を直接作成する（UC-008）。
 *
 * ステータスは受け取らない。どちらで作るかは画面の領域（URL）で決まり（ADR-016 決定 13）、
 * 仮予約か承認済みかはそれぞれのユースケースが決める（STATE-001）。
 *
 * 成功したら、作った予約を欄に開く URL へ転送する（ADR-014 決定 10）。
 * 送信の結果をそのまま描くと、再読み込みで同じ予約がもう一度作られてしまう。
 */
export async function createReservationAction({
  request,
  formData,
  user,
  actsAsStaff,
  area,
}: {
  readonly request: Request;
  readonly formData: FormData;
  readonly user: SessionUser;
  readonly actsAsStaff: boolean;
  readonly area: AppArea;
}): Promise<CreateReservationActionError> {
  const values = readValues(formData);
  const now = new Date();

  const { reservation, fieldErrors } = parseReservation(values, now);

  if (reservation === null) {
    return {
      intent: CREATE_RESERVATION_INTENT,
      values,
      fieldErrors,
      formError: null,
    };
  }

  const db = createDb(env.DB);
  // どちらで作るかは画面で決め、送られてきた値では決めない（ADR-016 決定 13）
  const isDirect = actsAsStaff;
  const deps = {
    reservationRepository: createReservationRepository(db),
    membershipRepository: createMembershipRepository(db),
    groupRepository: createGroupRepository(db),
    facilityRepository: createFacilityRepository(db),
  };
  const args = {
    actorUserId: user.id,
    isStaff: actsAsStaff,
    now,
    reservation,
    appBaseUrl: resolveAppBaseUrl(request),
  };

  // 直接作成ではメールを送らないので、通知に使う依存は申請のときだけ渡す
  const result = isDirect
    ? await createDirectReservationUseCase(deps, {
        ...args,
        unlockArrangement: values.unlockArrangement,
      })
    : await createProvisionalReservationUseCase(
        {
          ...deps,
          reservationMailRecipientsQuery: createReservationMailRecipientsQuery(db),
          mailOutboxNotifier: createQueueMailOutboxNotifier(),
        },
        args,
      );

  if (result.isErr()) {
    return {
      intent: CREATE_RESERVATION_INTENT,
      values,
      ...toFormErrors(
        reservationActionErrors(
          {
            where: isDirect ? "availability.create-direct" : "availability.create",
            userId: user.id,
          },
          result.error,
          fieldKeyOf,
        ),
      ),
    };
  }

  /*
   * 成功したら、作った予約を欄に開く URL へ転送する（ADR-014 決定 10）。
   * 基準の日は、送ってきた URL（request.url）の date から読む 4 週間に申請した日が入ればその date、
   * 入らなければ申請した日（resolveAnchorDateKey）。
   */
  const anchorDateKey = resolveAnchorDateKey(request.url, values.dateKey);

  throw redirect(
    toCalendarPath(area, reservation.facilityId, anchorDateKey, {
      kind: "reservation",
      reservationId: result.value.reservationId,
    }),
  );
}
