import { ok, ResultAsync } from "neverthrow";
import { FacilityErrorCode, type FacilityError } from "~/domain/facility";
import type {
  FacilityPhotoStorage,
  FacilityPhotoStorageItem,
  PutFacilityPhotoInput,
} from "~/domain/facility/facility-photo";
import { MediaPrefix } from "../media/media-bucket";

/**
 * Cloudflare R2 を利用した施設写真ストレージの実装。
 *
 * R2 のオブジェクトキーは `${MediaPrefix.FacilityPhotos}${photoName}` で構成し、
 * 接頭辞の付与はこのアダプタ内でのみ行う。
 */
export const createR2FacilityPhotoStorage = (bucket: R2Bucket): FacilityPhotoStorage => {
  const toR2Key = (photoName: string): string => `${MediaPrefix.FacilityPhotos}${photoName}`;

  const put = (input: PutFacilityPhotoInput): ResultAsync<void, FacilityError> =>
    ResultAsync.fromPromise(
      bucket.put(toR2Key(input.photoName), input.body, {
        httpMetadata: {
          contentType: input.contentType,
        },
      }),
      (error): FacilityError => ({
        code: FacilityErrorCode.PhotoStorageError,
        message: `R2 への写真 ${input.photoName} の保存に失敗した。`,
        cause: error,
      }),
    ).map(() => undefined);

  const deletePhoto = (photoName: string): ResultAsync<void, FacilityError> =>
    ResultAsync.fromPromise(bucket.delete(toR2Key(photoName)), (error): FacilityError => ({
      code: FacilityErrorCode.PhotoStorageError,
      message: `R2 からの写真 ${photoName} の削除に失敗した。`,
      cause: error,
    })).map(() => undefined);

  const get = (photoName: string): ResultAsync<FacilityPhotoStorageItem | null, FacilityError> =>
    ResultAsync.fromPromise(bucket.get(toR2Key(photoName)), (error): FacilityError => ({
      code: FacilityErrorCode.PhotoStorageError,
      message: `R2 からの写真 ${photoName} の取得に失敗した。`,
      cause: error,
    })).andThen((object) => {
      if (object === null) {
        return ok(null);
      }

      return ok({
        body: object.body,
        contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
        etag: object.httpEtag,
      });
    });

  return {
    put,
    delete: deletePhoto,
    get,
  };
};
