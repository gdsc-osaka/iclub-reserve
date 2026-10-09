import { okAsync, safeTry, type ResultAsync } from "neverthrow";

import type { QueryError } from "~/query/error";
import type {
  FacilityCalendarSubscriptionList,
  FacilityCalendarSubscriptionListQuery,
} from "~/query/facility/facility-calendar-subscription-list";

/** このユースケースが必要とする依存 */
export interface ListFacilitiesForCalendarSubscriptionDeps {
  readonly facilityCalendarSubscriptionListQuery: FacilityCalendarSubscriptionListQuery;
}

/** このユースケースへの入力 */
export interface ListFacilitiesForCalendarSubscriptionArgs {
  /** 一覧を閲覧しようとしている利用者の ID */
  readonly actorUserId: string;
}

/**
 * カレンダー一覧・購読ページ（SCR-010 / UC-018）で表示する施設一覧を取得するユースケース。
 *
 * 【認可と可視範囲】
 * ログイン済みの利用者であれば誰でも閲覧可能（REQ-030）。
 * カレンダー購読URLは一度入手すれば誰でも追加できる公開情報であるため、
 * 所属団体の有無や事務局権限による絞り込みは行わない。
 *
 * NOTE: 認可判定が無くてもこの層を素通しで残しているのは、
 * loader から Query を直接呼ぶ形にすると、今後のルール変更時に
 * 判定を挟む場所が無くなるため（ADR-001 決定 7）。
 */
export const listFacilitiesForCalendarSubscriptionUseCase = (
  deps: ListFacilitiesForCalendarSubscriptionDeps,
  _args: ListFacilitiesForCalendarSubscriptionArgs,
): ResultAsync<FacilityCalendarSubscriptionList, QueryError> =>
  safeTry(async function* () {
    const facilities = yield* deps.facilityCalendarSubscriptionListQuery.listActive();
    return okAsync(facilities);
  });
