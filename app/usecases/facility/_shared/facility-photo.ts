import { toFacilityPhotoNameFromUrl } from "~/domain/facility/facility-photo";
import type { FacilityPhotoStorage } from "~/domain/facility/facility-photo";

/**
 * 写真ストレージから古い写真を削除する。
 *
 * 【設計上の配慮（ADR-005）】
 * DB の更新が成功した後に古い写真を削除する。
 * もしこの削除が失敗しても、DB の更新は既に確定しているため、ユーザーへの操作結果としては
 * 成功を返し、エラーはログ（console.error）に記録して処理を継続する。
 * 画面にエラーを返すと利用者が再操作して二重更新等を起こす恐れがあるためである。
 * R2 に孤立したオブジェクトが残る可能性は許容する。
 */
export const deleteFacilityPhotoQuietly = async (
  storage: FacilityPhotoStorage,
  photoUrl: string | null | undefined,
): Promise<void> => {
  const photoName = toFacilityPhotoNameFromUrl(photoUrl);
  if (!photoName) {
    return;
  }

  const result = await storage.delete(photoName);
  if (result.isErr()) {
    console.error("古い施設写真の削除に失敗しました（処理は継続します）:", {
      photoName,
      error: result.error,
    });
  }
};
