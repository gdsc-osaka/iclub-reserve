import { env } from "cloudflare:workers";
import { data } from "react-router";

import { ReservationErrorCode } from "~/domain/reservation";
import { createDb } from "~/infra/db";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { getReservationUseCase } from "~/usecases/reservation/get-reservation";

import type { Route } from "./+types/route";

/**
 * 予約詳細画面（SCR-005）のローダー。
 *
 * 見ている人に見せてよい範囲まで絞った予約を返す（COND-008）。
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
      reservationRepository: createReservationRepository(db),
      membershipRepository: createMembershipRepository(db),
    },
    {
      reservationId: params.reservationId,
      actorUserId: user.id,
      isStaff: user.is_staff,
    },
  );

  if (result.isErr()) {
    if (result.error.code === ReservationErrorCode.ReservationNotFound) {
      throw data({ message: "Reservation Not Found." }, { status: 404 });
    }
    throw data({ message: "Internal server error" }, { status: 500 });
  }

  return result.value;
}

export default function Reservation({ loaderData: view }: Route.ComponentProps) {
  return <div>{JSON.stringify(view)}</div>;
}
