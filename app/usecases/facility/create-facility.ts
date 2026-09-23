import { errAsync, okAsync, ResultAsync, safeTry } from "neverthrow";

import {
  FacilityAction,
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
  toFacilityPhotoUrl,
  validateFacilityPhoto,
  type FacilityPhotoStorage,
} from "~/domain/facility/facility-photo";
import { ensureFacilityPermission } from "./_shared/facility-authorization";

export interface CreateFacilityDeps {
  readonly facilityRepository: FacilityRepository;
  readonly facilityPhotoStorage: FacilityPhotoStorage;
}

export interface CreateFacilityArgs {
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。施設登録は事務局限定 */
  readonly isStaff: boolean;
  readonly name: string;
  readonly description: string | null;
  readonly googleCalendarId: string | null;
  readonly photo: File | null;
  readonly isActive: boolean;
  readonly now: Date;
}

/**
 * 施設・設備を新規登録するユースケース（UC-015 / REQ-022）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. 認可判定: 事務局スタッフのみに許可（COND-009）。
 * 2. 入力検証: 名称、説明、Google Calendar ID、写真を順次検証。
 * 3. 写真アップロード: 写真が指定されている場合、R2 に先行して配置する。
 * 4. DB 登録: facility テーブルにレコードを挿入。
 * 5. ロールバック: DB 登録が失敗した場合、先行配置した R2 オブジェクトを削除して整合性を保つ。
 */
export const createFacilityUseCase = (
  deps: CreateFacilityDeps,
  args: CreateFacilityArgs,
): ResultAsync<Facility, FacilityError> =>
  safeTry(async function* () {
    // 1. 認可確認
    yield* ensureFacilityPermission({ isStaff: args.isStaff }, FacilityAction.Create);

    // 2. 入力検証
    const name = yield* validateFacilityName(args.name);
    const description = yield* validateFacilityDescription(args.description);
    const googleCalendarId = yield* validateGoogleCalendarId(args.googleCalendarId);
    const calendarUrl = toCalendarUrl(googleCalendarId);

    // 写真の検証
    let photoUrl: string | null = null;
    let uploadedPhotoName: string | null = null;

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
      photoUrl = toFacilityPhotoUrl(photoName);
    }

    // 3. DB 登録
    const createResult = await deps.facilityRepository.create({
      name,
      description,
      photoUrl,
      googleCalendarId,
      calendarUrl,
      isActive: args.isActive,
      createdAt: args.now,
      updatedAt: args.now,
    });

    if (createResult.isErr()) {
      // DB 登録失敗時は、アップロードした写真を削除してロールバックする
      if (uploadedPhotoName !== null) {
        await deps.facilityPhotoStorage.delete(uploadedPhotoName);
      }
      return errAsync(createResult.error);
    }

    return okAsync(createResult.value);
  });
