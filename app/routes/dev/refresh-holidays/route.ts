import { env } from "cloudflare:workers";
import { data } from "react-router";

import { createDb } from "~/infra/db";
import { createD1HolidayRepository } from "~/infra/holiday/d1-holiday-repository";
import { fetchHolidayIcal } from "~/infra/holiday/google-holiday-fetcher";
import { refreshHolidaysUseCase } from "~/usecases/holiday/refresh-holidays";

/**
 * 開発専用の祝日データ手動同期エンドポイント（ADR-010）。
 *
 * react-router dev では cron が自動では走らないため、
 * 手動で Google から祝日データを取得して D1 に反映できるようにする。
 * 本番やプレビューで実行されるのを防ぐため、APP_ENV が local 以外のときは 404 を返す。
 */
export async function action() {
  if (env.APP_ENV !== "local") {
    throw new Response(null, { status: 404 });
  }

  const db = createDb(env.DB);
  const holidayRepository = createD1HolidayRepository(db);

  const result = await refreshHolidaysUseCase({
    fetchHolidayIcal: () => fetchHolidayIcal(),
    holidayRepository,
  });

  if (result.isErr()) {
    // cause には例外や DB のエラーがそのまま入るので、返すのはコードだけにする。詳しくはログで見る
    console.error("refresh holidays failed:", result.error);
    return data({ error: result.error.code }, { status: 500 });
  }

  return data({
    success: true,
    holidayCount: result.value.holidayCount,
  });
}
