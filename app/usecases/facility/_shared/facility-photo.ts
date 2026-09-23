import type { FacilityPhotoStorage } from "~/domain/facility/facility-photo";

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
