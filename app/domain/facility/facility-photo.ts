import { createId } from "@paralleldrive/cuid2";
import { err, ok, type Result, type ResultAsync } from "neverthrow";
import { FacilityErrorCode, FacilityField, type FacilityError } from "./index";

/** 施設写真の最大サイズ（5 MiB） */
export const FACILITY_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** MIME タイプと拡張子の対応表 */
export const FACILITY_PHOTO_MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type SupportedPhotoMimeType = keyof typeof FACILITY_PHOTO_MIME_TO_EXT;
export type SupportedPhotoExtension = (typeof FACILITY_PHOTO_MIME_TO_EXT)[SupportedPhotoMimeType];

/**
 * 施設写真の誤りを表すエラーを作る。
 */
const invalidPhoto = (message: string, userMessage: string): FacilityError => ({
  code: FacilityErrorCode.InvalidInput,
  field: FacilityField.Photo,
  message,
  userMessage,
});

/**
 * 写真メタデータの検証を行う純粋関数。
 *
 * 【検証規則】
 * 1. ファイルサイズが 0 バイトの場合はエラー。
 * 2. ファイルサイズが 5 MiB を超える場合はエラー。
 * 3. 許可された MIME タイプ（JPEG, PNG, WebP）以外はエラー。
 */
export const validateFacilityPhoto = (photo: {
  readonly type: string;
  readonly size: number;
}): Result<{ readonly extension: SupportedPhotoExtension }, FacilityError> => {
  if (photo.size <= 0) {
    return err(invalidPhoto("写真のサイズが 0 バイトである。", "写真ファイルを選択してください。"));
  }

  if (photo.size > FACILITY_PHOTO_MAX_BYTES) {
    return err(
      invalidPhoto(
        `写真のサイズが ${FACILITY_PHOTO_MAX_BYTES} バイトを超えている。`,
        "写真は 5 MiB 以内のものを選択してください。",
      ),
    );
  }

  if (!Object.hasOwn(FACILITY_PHOTO_MIME_TO_EXT, photo.type)) {
    return err(
      invalidPhoto(
        `非対応の写真形式である: ${photo.type}`,
        "写真は JPEG、PNG、WebP 形式のみ対応しています。",
      ),
    );
  }

  const extension = FACILITY_PHOTO_MIME_TO_EXT[photo.type as SupportedPhotoMimeType];
  return ok({ extension });
};

/**
 * 新しい写真名を生成する。
 *
 * 利用者がアップロードした元のファイル名は使用せず、
 * CUID2 と対応する拡張子を組み合わせて安全なファイル名を生成する。
 */
export const toFacilityPhotoName = (contentType: string): Result<string, FacilityError> => {
  if (!Object.hasOwn(FACILITY_PHOTO_MIME_TO_EXT, contentType)) {
    return err(
      invalidPhoto(
        `非対応の写真形式である: ${contentType}`,
        "写真は JPEG、PNG、WebP 形式のみ対応しています。",
      ),
    );
  }

  const extension = FACILITY_PHOTO_MIME_TO_EXT[contentType as SupportedPhotoMimeType];
  return ok(`${createId()}.${extension}`);
};

/**
 * 写真名からアプリ内の配信 URL（相対パス）を生成する。
 */
export const toFacilityPhotoUrl = (photoName: string): string => `/facility-photos/${photoName}`;

/**
 * 配信 URL から写真名を取り出す逆変換。
 *
 * 形式が一致しない場合は null を返す。古い写真の削除時に使用する。
 */
export const toFacilityPhotoNameFromUrl = (url: string | null | undefined): string | null => {
  if (url === null || url === undefined) {
    return null;
  }

  const match = url.match(/^\/facility-photos\/([a-z0-9]+\.(?:jpg|png|webp))$/);
  return match ? match[1] : null;
};

/**
 * 配信ルートで写真名の形式（英小文字数字 + 対応拡張子）をチェックする関数。
 *
 * ディレクトリトラバーサル（../）などの不正な文字列を排除する。
 */
export const isFacilityPhotoName = (value: string): boolean =>
  /^[a-z0-9]+\.(jpg|png|webp)$/.test(value);

/** 写真の保存先への書き込み入力 */
export interface PutFacilityPhotoInput {
  readonly photoName: string;
  readonly body: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView;
  readonly contentType: string;
}

/** 写真ストレージから読み取った写真情報 */
export interface FacilityPhotoStorageItem {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly etag: string;
}

/**
 * 施設写真のストレージ（ポートインターフェース）。
 *
 * ドメイン層は R2 のキー接頭辞を知らず、写真名のみでやり取りする。
 * 接頭辞の付与・削除はインフラ層のアダプタが担う。
 */
export interface FacilityPhotoStorage {
  put(input: PutFacilityPhotoInput): ResultAsync<void, FacilityError>;
  delete(photoName: string): ResultAsync<void, FacilityError>;
  get(photoName: string): ResultAsync<FacilityPhotoStorageItem | null, FacilityError>;
}
