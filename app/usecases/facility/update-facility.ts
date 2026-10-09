import { errAsync, okAsync, ResultAsync, safeTry } from "neverthrow";

import { AuditLogAction, type AuditLogDraft } from "~/domain/audit-log";
import {
  FacilityAction,
  FacilityErrorCode,
  type Facility,
  type FacilityError,
  type FacilityRepository,
} from "~/domain/facility";
import { toFacilityUpdateChanges } from "~/domain/facility/audit-log";
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
import {
  calendarSyncRangeStart,
  toFacilityCalendarResync,
  type CalendarClient,
} from "~/domain/calendar";
import { ensureFacilityPermission } from "./_shared/facility-authorization";
import { ensureCalendarWritable } from "./_shared/facility-calendar";
import { deleteFacilityPhotoQuietly, resolveFacilityPhotoHead } from "./_shared/facility-photo";

export interface UpdateFacilityDeps {
  readonly facilityRepository: FacilityRepository;
  readonly facilityPhotoStorage: FacilityPhotoStorage;
  readonly calendarClient: CalendarClient;
  readonly calendarWriterEmail: string | null;
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
 * 4. Calendar ID の書き込み確認（COND-025）:
 *    - ID を変えて、変更後が空でないときだけ、システムが予定を書き込めることを確かめる。
 *    - 書き込めなければここで止め、写真を R2 に上げない。
 * 5. 写真の差し替え・取り外し処理:
 *    - 新しい写真がある場合: R2 にアップロードし、古い写真は後で削除対象にする。
 *    - 写真がなく removePhoto が指定された場合: photoUrl を null にし、古い写真を削除対象にする。
 *    - いずれでもない場合: 既存の photoUrl をそのまま維持する。
 * 6. 変更差分の判定（COND-013）:
 *    - 変わった項目が無い場合は業務データも記録も書かずに成功。
 * 7. Google Calendar にまとめて反映するかの判定（COND-024 の (3)）:
 *    - 名称を変えたとき、または ID を変えて変更後が空でないときは、範囲内の承認済み予約を同期し直す。
 * 8. DB 更新: facility テーブルを更新。同じ batch で操作履歴を記録し（COND-013）、7 が真なら同期タスクも積む。
 *    - 3 で読んだ写真の URL を条件に入れる。その間に別の人が写真を変えていたら Conflict になる。
 *    - 写真以外の項目は条件に入れていないので、読んでから書くまでに別の人が変えると、記録の変更前が実際とずれることがある。
 *    - 失敗時（Conflict を含む）: 今回新しくアップロードした写真があれば削除（ロールバック）。操作履歴も同期タスクも残らない。
 * 9. 古い写真の削除: DB 更新が成功した後に実行。削除失敗時も操作は成功として返しログを残す。
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

    // 4. Calendar ID を変更して保存する場合（かつ変更後が null でない場合）のみ書き込み権限を確認（COND-025）
    // 写真を R2 に上げる前に確認し、権限不足で写真を上げてから消す無駄を防ぐ
    if (existing.googleCalendarId !== googleCalendarId && googleCalendarId !== null) {
      yield* ensureCalendarWritable({
        calendarClient: deps.calendarClient,
        googleCalendarId,
        calendarWriterEmail: deps.calendarWriterEmail,
      });
    }

    // 5. 写真の処理
    let newPhotoUrl: string | null = existing.photoUrl;
    let uploadedPhotoName: string | null = null;
    let oldPhotoToDelete: string | null = null;

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
      newPhotoUrl = toFacilityPhotoUrl(photoName);
      oldPhotoToDelete = existing.photoUrl;
    } else if (args.removePhoto) {
      newPhotoUrl = null;
      oldPhotoToDelete = existing.photoUrl;
    }

    const changes = toFacilityUpdateChanges(existing, {
      name,
      description,
      photoUrl: newPhotoUrl,
      googleCalendarId,
      calendarUrl,
    });

    // 6. 変更がない場合は業務データも記録も書かずに成功（COND-013）
    if (Object.keys(changes).length === 0) {
      return okAsync(existing);
    }

    const auditLog: AuditLogDraft = {
      occurredAt: args.now,
      actorId: args.actorUserId,
      actedAsStaff: true, // 事務局だけの操作なので常に true（COND-012）
      action: AuditLogAction.FacilityUpdate,
      targetId: facilityId,
      groupId: null,
      changes,
    };

    // 7. まとめて反映するかの判定（COND-024 (3)）
    const shouldResyncCalendar = toFacilityCalendarResync(
      { name: existing.name, googleCalendarId: existing.googleCalendarId },
      { name, googleCalendarId },
    );
    const calendarResync = shouldResyncCalendar
      ? { rangeStart: calendarSyncRangeStart(args.now) }
      : null;

    // 8. DB 更新
    const updateResult = await deps.facilityRepository.update(
      {
        id: facilityId,
        name,
        description,
        photoUrl: newPhotoUrl,
        expectedPhotoUrl: existing.photoUrl,
        googleCalendarId,
        calendarUrl,
        updatedAt: args.now,
      },
      auditLog,
      calendarResync,
    );

    if (updateResult.isErr()) {
      // DB 更新失敗時は新しく置いた写真を削除してロールバック
      if (uploadedPhotoName !== null) {
        await deleteFacilityPhotoQuietly(deps.facilityPhotoStorage, uploadedPhotoName);
      }
      return errAsync(updateResult.error);
    }

    // 9. DB 更新成功後、古い写真を静かに削除
    const oldPhotoName =
      oldPhotoToDelete !== newPhotoUrl ? toFacilityPhotoNameFromUrl(oldPhotoToDelete) : null;
    if (oldPhotoName !== null) {
      await deleteFacilityPhotoQuietly(deps.facilityPhotoStorage, oldPhotoName);
    }

    return okAsync(updateResult.value);
  });
