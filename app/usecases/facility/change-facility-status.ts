import { err, errAsync, ok, okAsync, ResultAsync, safeTry, type Result } from "neverthrow";

import {
  FacilityAction,
  FacilityErrorCode,
  type Facility,
  type FacilityError,
  type FacilityRepository,
} from "~/domain/facility";
import { ensureFacilityPermission } from "./_shared/facility-authorization";

export interface ChangeFacilityStatusDeps {
  readonly facilityRepository: FacilityRepository;
}

export interface ChangeFacilityStatusArgs {
  readonly facilityId: string;
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。施設ステータス変更は事務局限定 */
  readonly isStaff: boolean;
  /** フォームから届いた変更後のステータス文字列（"active" または "inactive"） */
  readonly status: string;
  readonly now: Date;
}

/**
 * 変更先ステータス文字列を検証する。
 *
 * 指定できるのは "active" または "inactive" のみ。
 */
const validateTargetStatus = (status: string): Result<boolean, FacilityError> => {
  if (status === "active") {
    return ok(true);
  }
  if (status === "inactive") {
    return ok(false);
  }

  return err({
    code: FacilityErrorCode.InvalidInput,
    message: `変更後のステータスに不正な値が指定された: ${status}`,
    userMessage: "変更後の状態は「有効」または「無効」を指定してください。",
  });
};

/**
 * 施設・設備の有効化・無効化を行うユースケース（UC-016 / REQ-024 / COND-003）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. facilityId のトリム検証: 空文字の場合は NotFound を返す。
 * 2. status の入力検証: "active" / "inactive" 以外は InvalidInput を返す。
 * 3. 認可判定: 事務局スタッフのみに許可（COND-009）。
 * 4. 施設の取得: 存在しなければ NotFound を返す。
 * 5. 状態遷移の検証: 同じ状態への変更は InvalidTransition を返す。
 * 6. 無効化の事前条件検証（COND-003）:
 *    無効化（inactive への変更）時のみ、countBlockingReservations を呼び出し、
 *    将来の予約が 1 件以上残っていれば HasUpcomingReservations を返す。
 *    再有効化（active への変更）時は予約件数の確認を行わない。
 * 7. 楽観的ロックを伴う更新（updateActiveStatus）:
 *    WHERE id = ? AND is_active = from に加え、無効化時は NOT EXISTS で
 *    競合による予約挿入を防ぐ。0 行更新なら InvalidTransition を返す。
 */
export const changeFacilityStatusUseCase = (
  deps: ChangeFacilityStatusDeps,
  args: ChangeFacilityStatusArgs,
): ResultAsync<Facility, FacilityError> =>
  safeTry(async function* () {
    const facilityId = args.facilityId.trim();
    if (facilityId === "") {
      return errAsync({
        code: FacilityErrorCode.NotFound,
        message: "施設 ID が空である。",
      });
    }

    const targetIsActive = yield* validateTargetStatus(args.status);

    // 認可判定
    yield* ensureFacilityPermission({ isStaff: args.isStaff }, FacilityAction.ChangeStatus);

    const facility = yield* deps.facilityRepository.findById(facilityId);

    // 同じ状態への変更はエラー
    if (facility.isActive === targetIsActive) {
      return errAsync({
        code: FacilityErrorCode.InvalidTransition,
        message: `施設 ${facilityId} の状態はすでに ${facility.isActive ? "有効" : "無効"} である。`,
        userMessage: "施設の状態が変わっています。画面を読み込み直してください。",
      });
    }

    // 無効化時のみ COND-003 の前提条件を検証
    if (!targetIsActive) {
      const blockingCount = yield* deps.facilityRepository.countBlockingReservations(
        facilityId,
        args.now,
      );

      if (blockingCount > 0) {
        return errAsync({
          code: FacilityErrorCode.HasUpcomingReservations,
          message: `施設 ${facilityId} には今後の予約が ${blockingCount} 件残っているため、無効化できない。`,
          userMessage: `今後の予約が ${blockingCount} 件残っているため、無効化できません。予約を却下またはキャンセルしてから、もう一度お試しください。`,
        });
      }
    }

    const updated = yield* deps.facilityRepository.updateActiveStatus({
      id: facilityId,
      from: facility.isActive,
      to: targetIsActive,
      updatedAt: args.now,
      now: args.now,
    });

    return okAsync(updated);
  });
