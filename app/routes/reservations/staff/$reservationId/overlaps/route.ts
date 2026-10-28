import { env } from "cloudflare:workers";
import type { LoaderFunctionArgs } from "react-router";

import { createDb } from "~/infra/db";
import { AppArea } from "~/lib/app-area";
import { findOverlapResolution } from "~/query/reservation/overlap-resolution";
import { requireAreaUser } from "~/routes/_shared/app-area.server";
import { queryErrorResponse } from "~/routes/_shared/query-error.server";

/**
 * 重なりの解決ダイアログが開いたときに読む、仮予約のまとまりの読み取りルート（COND-031）。
 *
 * 事務局専用のリソースルートであり、画面は持たない（ADR-012）。
 */
export async function loader({ params, context }: LoaderFunctionArgs) {
  const where = "staff.reservation-overlaps.loader";
  const { user, actsAsStaff } = await requireAreaUser(context, AppArea.Staff, where);

  const reservationId = params.reservationId;
  if (!reservationId) {
    throw new Response("Not Found", { status: 404 });
  }

  const db = createDb(env.DB);
  const result = await findOverlapResolution(db, {
    isStaff: actsAsStaff,
    reservationId,
  });

  if (result.isErr()) {
    throw queryErrorResponse({ where, userId: user.id }, result.error);
  }

  return result.value;
}
