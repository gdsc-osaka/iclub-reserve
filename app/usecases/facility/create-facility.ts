import { createId } from "@paralleldrive/cuid2";
import { errAsync, okAsync, ResultAsync, safeTry } from "neverthrow";

import { AuditLogAction, type AuditLogDraft } from "~/domain/audit-log";
import {
  FacilityAction,
  type Facility,
  type FacilityError,
  type FacilityRepository,
} from "~/domain/facility";
import { toFacilityCreateChanges } from "~/domain/facility/audit-log";
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
import type { CalendarClient } from "~/domain/calendar";
import { ensureFacilityPermission } from "./_shared/facility-authorization";
import { ensureCalendarWritable } from "./_shared/facility-calendar";
import { deleteFacilityPhotoQuietly, resolveFacilityPhotoHead } from "./_shared/facility-photo";

export interface CreateFacilityDeps {
  readonly facilityRepository: FacilityRepository;
  readonly facilityPhotoStorage: FacilityPhotoStorage;
  readonly calendarClient: CalendarClient;
  readonly calendarWriterEmail: string | null;
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
 * 2. 入力検証: 名称、説明、Google Calendar ID を検証。
 * 3. Calendar ID の書き込み確認: ID が指定されていれば、システムが予定を書き込めることを確かめる（COND-025）。
 *    書き込めなければここで止め、写真を R2 に上げない。
 * 4. 写真の検証とアップロード: 写真が指定されている場合、形式を確かめて R2 に先行して配置する。
 * 5. DB 登録: facility テーブルにレコードを挿入。同じ batch で操作履歴を記録する（COND-013）。
 * 6. ロールバック: DB 登録が失敗した場合、先行配置した R2 オブジェクトを削除して整合性を保つ。
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

    // 3. Calendar ID が設定されている場合は書き込み権限を確認（COND-025）
    // 写真を R2 に上げる前に確認し、権限不足で写真を上げてから消す無駄を防ぐ
    if (googleCalendarId !== null) {
      yield* ensureCalendarWritable({
        calendarClient: deps.calendarClient,
        googleCalendarId,
        calendarWriterEmail: deps.calendarWriterEmail,
      });
    }

    // 4. 写真の検証とアップロード
    let photoUrl: string | null = null;
    let uploadedPhotoName: string | null = null;

    if (args.photo !== null && args.photo.size > 0) {
      // 形式は申告された MIME タイプではなく、先頭のバイトで決める（ADR-005 決定 8）
      const head = yield* resolveFacilityPhotoHead(args.photo);
      const format = yield* validateFacilityPhoto({ size: args.photo.size, head });

      const photoName = toFacilityPhotoName(format.extension);
      yield* deps.facilityPhotoStorage.put({
        photoName,
        body: args.photo.stream(),
        contentType: format.contentType,
      });

      uploadedPhotoName = photoName;
      photoUrl = toFacilityPhotoUrl(photoName);
    }

    const facilityId = createId();

    const auditLog: AuditLogDraft = {
      occurredAt: args.now,
      actorId: args.actorUserId,
      actedAsStaff: true, // 事務局だけの操作なので常に true（COND-012）
      action: AuditLogAction.FacilityCreate,
      targetId: facilityId,
      groupId: null,
      changes: toFacilityCreateChanges({
        name,
        description,
        photoUrl,
        googleCalendarId,
        calendarUrl,
        isActive: args.isActive,
      }),
    };

    // 5. DB 登録
    const createResult = await deps.facilityRepository.create(
      {
        id: facilityId,
        name,
        description,
        photoUrl,
        googleCalendarId,
        calendarUrl,
        isActive: args.isActive,
        createdAt: args.now,
        updatedAt: args.now,
      },
      auditLog,
    );

    if (createResult.isErr()) {
      // DB 登録失敗時は、アップロードした写真を削除してロールバックする
      if (uploadedPhotoName !== null) {
        await deleteFacilityPhotoQuietly(deps.facilityPhotoStorage, uploadedPhotoName);
      }
      return errAsync(createResult.error);
    }

    return okAsync(createResult.value);
  });
