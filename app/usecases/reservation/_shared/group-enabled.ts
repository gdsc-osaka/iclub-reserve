import { errAsync, okAsync, type ResultAsync } from "neverthrow";

import { GroupErrorCode, GroupStatus, type GroupRepository } from "~/domain/group";
import {
  ReservationErrorCode,
  ReservationField,
  type ReservationError,
} from "~/domain/reservation";

/** 団体の状態を確かめるために必要な依存 */
export interface GroupEnabledDeps {
  readonly groupRepository: GroupRepository;
}

/**
 * 予約を作る団体が有効かを確かめる（COND-006 / STATE-001）。
 *
 * 権限の確認より後に置いている。先にここを通すと、団体に所属していない人が
 * 団体 ID を当てずっぽうに送るだけで「その団体が有効かどうか」を読み取れてしまう。
 *
 * 拒否したときに利用者へ出す文言を引数で受け取るのは、仮予約の申請（UC-002）と
 * 事務局による直接作成（UC-008）で利用者に伝える文言が変わるため。
 */
export const ensureGroupIsEnabled = (
  deps: GroupEnabledDeps,
  groupId: string,
  userMessage: string,
): ResultAsync<null, ReservationError> =>
  deps.groupRepository
    .findById(groupId)
    .mapErr((error): ReservationError =>
      error.code === GroupErrorCode.NotFound
        ? {
            code: ReservationErrorCode.GroupNotEligible,
            field: ReservationField.Group,
            message: `申請元の団体 ${groupId} が見つからない。`,
            userMessage: "選んだ団体が見つかりません。",
          }
        : {
            code: ReservationErrorCode.DatabaseError,
            message: "申請元の団体を読み取れなかった。",
            cause: error,
          },
    )
    .andThen((group) =>
      group.status === GroupStatus.Enabled
        ? okAsync(null)
        : errAsync({
            code: ReservationErrorCode.GroupNotEligible,
            field: ReservationField.Group,
            message: `申請元の団体 ${groupId} が有効でない (${group.status})。`,
            userMessage,
          } satisfies ReservationError),
    );
