import { ResultAsync } from "neverthrow";

import { FacilityErrorCode, FacilityField, type FacilityError } from "~/domain/facility";
import {
  FACILITY_PHOTO_HEAD_BYTES,
  type FacilityPhotoStorage,
} from "~/domain/facility/facility-photo";

/**
 * アップロードされた写真の先頭のバイトを読む。形式の判定（`validateFacilityPhoto`）に渡す。
 *
 * 読むのは先頭の `FACILITY_PHOTO_HEAD_BYTES` バイトだけで、写真全体は読まない。
 */
export const resolveFacilityPhotoHead = (photo: Blob): ResultAsync<Uint8Array, FacilityError> =>
  ResultAsync.fromPromise(
    photo.slice(0, FACILITY_PHOTO_HEAD_BYTES).arrayBuffer(),
    (error): FacilityError => ({
      code: FacilityErrorCode.InvalidInput,
      field: FacilityField.Photo,
      message: "アップロードされた写真の先頭を読み取れなかった。",
      userMessage: "写真を読み込めませんでした。もう一度選択してください。",
      cause: error,
    }),
  ).map((buffer) => new Uint8Array(buffer));

/**
 * 写真ストレージから写真を消す。失敗してもログに残すだけで、呼び出し元には伝えない。
 *
 * 【設計上の配慮（ADR-005）】
 * 次の 2 か所で使う。どちらも、消せなくても利用者に見せる結果は変わらない。
 * - DB の更新が成功した後に、差し替え前の写真を消すとき。DB の更新は確定しているので成功を返す。
 *   画面にエラーを返すと、利用者が再操作して二重に更新する恐れがある。
 * - DB への書き込みが失敗したときに、先に置いた写真を片付けるとき。利用者には DB の失敗を返す。
 * R2 に孤立した写真が残ることは許容する。
 */
export const deleteFacilityPhotoQuietly = async (
  storage: FacilityPhotoStorage,
  photoName: string,
): Promise<void> => {
  const result = await storage.delete(photoName);
  if (result.isErr()) {
    console.error("施設写真を消せなかった（処理は続ける。R2 に孤立した写真が残る）:", {
      photoName,
      error: result.error,
    });
  }
};
