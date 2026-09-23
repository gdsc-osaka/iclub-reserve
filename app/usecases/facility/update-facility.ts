import { errAsync, okAsync, ResultAsync, safeTry } from "neverthrow";

import {
  FacilityAction,
  FacilityErrorCode,
  type Facility,
  type FacilityError,
  type FacilityRepository,
} from "~/domain/facility";
import {
  toCalendarUrl,
  validateFacilityDescription,
  validateFacilityName,
  validateGoogleCalendarId,
} from "~/domain/facility/facility-input";
import {
  toFacilityPhotoName,
  toFacilityPhotoNameFromUrl,
  toFacilityPhotoUrl,
  validateFacilityPhoto,
  type FacilityPhotoStorage,
} from "~/domain/facility/facility-photo";
import { ensureFacilityPermission } from "./_shared/facility-authorization";
import { deleteFacilityPhotoQuietly } from "./_shared/facility-photo";

export interface UpdateFacilityDeps {
  readonly facilityRepository: FacilityRepository;
  readonly facilityPhotoStorage: FacilityPhotoStorage;
}

export interface UpdateFacilityArgs {
  readonly facilityId: string;
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。施設編集は事務局限定 */
  readonly isStaff: boolean;
  readonly name: string;
  readonly description: string | null;
  readonly googleCalendarId: string | null;
  readonly photo: File | null;
  readonly removePhoto: boolean;
  readonly now: Date;
}

/**
 * 施設・設備の情報を編集するユースケース（UC-015 / REQ-023）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. 認可判定: 事務局スタッフのみに許可（COND-009）。
 * 2. 入力検証: 名称、説明、Google Calendar ID を検証。
 * 3. 既存施設の取得: 存在しなければ NotFound を返す。
 * 4. 写真の差し替え・取り外し処理:
 *    - 新しい写真がある場合: R2 にアップロードし、古い写真は後で削除対象にする。
 *    - 写真がなく removePhoto が指定された場合: photoUrl を null にし、古い写真を削除対象にする。
 *    - いずれでもない場合: 既存の photoUrl をそのまま維持する。
 * 5. DB 更新: facility テーブルを更新。
 *    - 失敗時: 今回新しくアップロードした写真があれば削除（ロールバック）。
 * 6. 古い写真の削除: DB 更新が成功した後に実行。削除失敗時も操作は成功として返しログを残す。
 */
export const updateFacilityUseCase = (
  deps: UpdateFacilityDeps,
  args: UpdateFacilityArgs,
): ResultAsync<Facility, FacilityError> =>
  safeTry(async function* () {
    const facilityId = args.facilityId.trim();
    if (facilityId === "") {
      return errAsync({
        code: FacilityErrorCode.NotFound,
        message: "施設 ID が空である。",
      });
    }

    // 1. 認可確認
    yield* ensureFacilityPermission({ isStaff: args.isStaff }, FacilityAction.Update);

    // 2. 入力検証
    const name = yield* validateFacilityName(args.name);
    const description = yield* validateFacilityDescription(args.description);
    const googleCalendarId = yield* validateGoogleCalendarId(args.googleCalendarId);
    const calendarUrl = toCalendarUrl(googleCalendarId);

    // 3. 既存施設の取得
    const existing = yield* deps.facilityRepository.findById(facilityId);

    // 4. 写真の処理
    let newPhotoUrl: string | null = existing.photoUrl;
    let uploadedPhotoName: string | null = null;
    let oldPhotoToDelete: string | null = null;

    if (args.photo !== null && args.photo.size > 0) {
      yield* validateFacilityPhoto({
        type: args.photo.type,
        size: args.photo.size,
      });

      const photoName = yield* toFacilityPhotoName(args.photo.type);
      yield* deps.facilityPhotoStorage.put({
        photoName,
        body: args.photo.stream(),
        contentType: args.photo.type,
      });

      uploadedPhotoName = photoName;
      newPhotoUrl = toFacilityPhotoUrl(photoName);
      oldPhotoToDelete = existing.photoUrl;
    } else if (args.removePhoto) {
      newPhotoUrl = null;
      oldPhotoToDelete = existing.photoUrl;
    }

    // 5. DB 更新
    const updateResult = await deps.facilityRepository.update({
      id: facilityId,
      name,
      description,
      photoUrl: newPhotoUrl,
      googleCalendarId,
      calendarUrl,
      updatedAt: args.now,
    });

    if (updateResult.isErr()) {
      // DB 更新失敗時は新しく置いた写真を削除してロールバック
      if (uploadedPhotoName !== null) {
        await deleteFacilityPhotoQuietly(deps.facilityPhotoStorage, uploadedPhotoName);
      }
      return errAsync(updateResult.error);
    }

    // 6. DB 更新成功後、古い写真を静かに削除
    const oldPhotoName =
      oldPhotoToDelete !== newPhotoUrl ? toFacilityPhotoNameFromUrl(oldPhotoToDelete) : null;
    if (oldPhotoName !== null) {
      await deleteFacilityPhotoQuietly(deps.facilityPhotoStorage, oldPhotoName);
    }

    return okAsync(updateResult.value);
  });
