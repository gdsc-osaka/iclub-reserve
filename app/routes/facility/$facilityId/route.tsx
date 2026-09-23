import { env } from "cloudflare:workers";
import { data } from "react-router";

import { FacilityErrorCode } from "~/domain/facility";
import { createDb } from "~/infra/db";
import { createFacilityRepository } from "~/infra/facility/facility-repo";
import { logServerError } from "~/lib/log.server";
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
export async function loader({ params }: Route.LoaderArgs) {
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
    const error = facilityResult.error;

    // 無い施設を開いたのは想定内の応答なので、ログには残さない
    if (error.code === FacilityErrorCode.FacilityNotFound) {
      throw data({ message: "Facility Not Found." }, { status: 404 });
    }

    /*
     * 失敗の中身は画面へ出さない。利用者にできることは増えず、
     * こちらの内部の事情だけが伝わってしまう。原因はサーバー側のログにだけ残す。
     */
    logServerError("facility.detail.loader", error);
    throw data({ message: "Internal server error." }, { status: 500 });
  }

  return facilityResult.value;
}

/** 施設の詳細画面。施設 1 件の登録情報を表示する。 */
export default function Facility({ loaderData: facility }: Route.ComponentProps) {
  return <div>{JSON.stringify(facility)}</div>;
}
