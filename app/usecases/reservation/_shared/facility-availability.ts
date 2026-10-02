import { errAsync, okAsync, type ResultAsync } from "neverthrow";

import { FacilityErrorCode, type FacilityRepository } from "~/domain/facility";
import {
  ReservationErrorCode,
  ReservationField,
  type ReservationError,
} from "~/domain/reservation";

/** 施設・設備の状態を確かめるために必要な依存 */
export interface FacilityAvailabilityDeps {
  readonly facilityRepository: FacilityRepository;
}

/**
 * 予約先の施設・設備が使えるかを確かめる（COND-021）。
 *
 * 画面（SCR-002）の選択肢は有効な施設だけに絞ってあるが、それとは別にここでも確かめる。
 * `facility_id` は POST を組み立てれば自由に送れるので、選択肢だけに頼ると
 * 無効化された施設の予約が作れてしまう。その予約は空き状況カレンダーにも
 * 申請フォームにも出ない（どちらも `is_active` で絞っている）ので、
 * 誰の画面にも現れないまま残り続ける。無効化の条件（COND-003: 将来の予約が
 * すべて終了していること）も、後から予約を足したり移したりできるなら意味をなさない。
 *
 * 申請（UC-002）と、予約の施設を変えるとき（UC-005 / UC-017）に使う。
 */
export const ensureFacilityIsAvailable = (
  deps: FacilityAvailabilityDeps,
  facilityId: string,
): ResultAsync<null, ReservationError> =>
  deps.facilityRepository
    .findById(facilityId)
    .mapErr((error): ReservationError =>
      error.code === FacilityErrorCode.NotFound
        ? {
            code: ReservationErrorCode.FacilityNotAvailable,
            field: ReservationField.Facility,
            message: `予約先の施設 ${facilityId} が見つからない。`,
            userMessage: "選んだ施設・設備が見つかりません。",
          }
        : {
            code: ReservationErrorCode.DatabaseError,
            message: "予約先の施設を読み取れなかった。",
            cause: error,
          },
    )
    .andThen((facility) =>
      facility.isActive
        ? okAsync(null)
        : errAsync({
            code: ReservationErrorCode.FacilityNotAvailable,
            field: ReservationField.Facility,
            message: `予約先の施設 ${facilityId} が無効になっている。`,
            userMessage: "選んだ施設・設備は、いま予約を受け付けていません。",
          } satisfies ReservationError),
    );
