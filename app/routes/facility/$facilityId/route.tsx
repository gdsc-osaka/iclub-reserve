import { env } from "cloudflare:workers";

import { createDb } from "~/infra/db";
import { createFacilityRepository } from "~/infra/facility/facility-repo";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { facilityErrorResponse } from "~/routes/_shared/facility-error.server";
import {
  getFacilityUseCase,
  type GetFacilityArgs,
  type GetFacilityDeps,
} from "~/usecases/facility/get-facility";

import type { Route } from "./+types/route";

/**
 * ページを表示する前に、サーバー側で施設情報を取得。
 *
 * `export default function Facility({ loaderData: facility }: Route.ComponentProps)`
 * として取得できる。
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  // この画面はログイン必須 (root.tsx のミドルウェアが先に確認している)
  const user = requireRequestUser(context);
  const facilityId = params.facilityId;

  const db = createDb(env.DB);
  const Deps: GetFacilityDeps = {
    facilityRepository: createFacilityRepository(db),
  };
  const Args: GetFacilityArgs = {
    facilityId: facilityId,
  };
  const facilityResult = await getFacilityUseCase(Deps, Args);
  if (facilityResult.isErr()) {
    /*
     * 無い施設は 404、DB の失敗は 500 になる。どちらもログに残り、
     * 失敗の中身（DB のエラーなど）は画面へ出さない。決めているのは表の側
     */
    throw facilityErrorResponse(
      { where: "facility.detail.loader", userId: user.id },
      facilityResult.error,
    );
  }

  return facilityResult.value;
}

/** 施設の詳細画面。施設 1 件の登録情報を表示する。 */
export default function Facility({ loaderData: facility }: Route.ComponentProps) {
  return <div>{JSON.stringify(facility)}</div>;
}
