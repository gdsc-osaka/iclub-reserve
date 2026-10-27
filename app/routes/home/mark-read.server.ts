import type { Database } from "~/infra/db";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationReadRepository } from "~/infra/reservation/reservation-read-repo";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import type { SessionUser } from "~/lib/auth/auth-session.server";
import { reservationActionErrors } from "~/routes/_shared/reservation-error.server";
import { markReservationReadUseCase } from "~/usecases/reservation/mark-reservation-read";

import { readFormText } from "./read-form-text";

/**
 * 予約 1 件を確認済みにする（UC-037）。
 *
 * 利用者のダッシュボードと事務局のダッシュボードの両方の action で使用する。
 * 失敗時は reservationActionErrors、成功時は { ok: true } を返す。
 */
export const markReservationRead = async ({
  db,
  user,
  formData,
  now,
  where,
  actsAsStaff,
}: {
  readonly db: Database;
  readonly user: SessionUser;
  readonly formData: FormData;
  readonly now: Date;
  readonly where: string;
  readonly actsAsStaff: boolean;
}) => {
  const result = await markReservationReadUseCase(
    {
      reservationReadRepository: createReservationReadRepository(db),
      reservationRepository: createReservationRepository(db),
      membershipRepository: createMembershipRepository(db),
    },
    {
      reservationId: readFormText(formData, "reservationId"),
      actorUserId: user.id,
      // 画面の立場に応じて、利用者のダッシュボードでは団体側として、事務局のダッシュボードでは事務局として確認済みにする（ADR-016 決定 14）
      isStaff: actsAsStaff,
      now,
    },
  );

  if (result.isErr()) {
    return reservationActionErrors({ where, userId: user.id }, result.error);
  }
  return { ok: true } as const;
};
