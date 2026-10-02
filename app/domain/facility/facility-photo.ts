import { createId } from "@paralleldrive/cuid2";
import { err, ok, type Result, type ResultAsync } from "neverthrow";
import { FacilityErrorCode, FacilityField, type FacilityError } from "./index";

/** 施設写真の最大サイズ（5 MiB） */
export const FACILITY_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** 受け付ける写真の形式（ADR-005 決定 8） */
export interface FacilityPhotoFormat {
  /** R2 に保存し、配信時に返す Content-Type */
  readonly contentType: "image/jpeg" | "image/png" | "image/webp";
  /** 写真名に付ける拡張子 */
  readonly extension: "jpg" | "png" | "webp";
}

/** 形式の判定に読む先頭のバイト数。WebP の判定に 12 バイト要る */
export const FACILITY_PHOTO_HEAD_BYTES = 12;

/** `head` の `offset` バイト目から `signature` が並んでいるか */
const hasBytesAt = (head: Uint8Array, offset: number, signature: readonly number[]): boolean =>
  signature.every((byte, i) => head[offset + i] === byte);

/** "RIFF" と "WEBP" の ASCII */
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/**
 * 形式ごとの見分け方（ファイルの先頭に置かれる決まったバイト列、マジックナンバー）。
 *
 * - JPEG: `FF D8 FF` で始まる
 * - PNG: `89 50 4E 47 0D 0A 1A 0A`（`\x89PNG\r\n\x1a\n`）で始まる
 * - WebP: `RIFF` で始まり、8 バイト目から `WEBP` が続く（4〜7 バイト目はファイルの大きさ）
 */
const FACILITY_PHOTO_FORMATS: readonly (FacilityPhotoFormat & {
  readonly matches: (head: Uint8Array) => boolean;
})[] = [
  {
    contentType: "image/jpeg",
    extension: "jpg",
    matches: (head) => hasBytesAt(head, 0, [0xff, 0xd8, 0xff]),
  },
  {
    contentType: "image/png",
    extension: "png",
    matches: (head) => hasBytesAt(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    contentType: "image/webp",
    extension: "webp",
    matches: (head) => hasBytesAt(head, 0, RIFF) && hasBytesAt(head, 8, WEBP),
  },
];

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
 * アップロードされた写真の大きさと形式を検証し、形式を返す純粋関数。
 *
 * 【検証規則】
 * 1. ファイルサイズが 0 バイトの場合はエラー。
 * 2. ファイルサイズが 5 MiB を超える場合はエラー。
 * 3. 先頭のバイト（`head`）が JPEG・PNG・WebP のどれにも当たらない場合はエラー。
 *
 * ブラウザが申告する MIME タイプ（`File.type`）は、ファイル名の拡張子から決まるだけで中身を表さない。
 * そのため判定には使わず、保存する Content-Type と拡張子も先頭のバイトから決める。
 * 拡張子が中身と違うだけのファイル（中身が PNG の `photo.jpg` など）は、中身の形式として受け付ける。
 *
 * @param photo.head ファイルの先頭 `FACILITY_PHOTO_HEAD_BYTES` バイト。短いファイルならそれより短くてよい
 */
export const validateFacilityPhoto = (photo: {
  readonly size: number;
  readonly head: Uint8Array;
}): Result<FacilityPhotoFormat, FacilityError> => {
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

  const format = FACILITY_PHOTO_FORMATS.find(({ matches }) => matches(photo.head));
  if (format === undefined) {
    return err(
      invalidPhoto(
        "写真の先頭のバイトが、対応する形式のどれにも当たらない。",
        "写真は JPEG、PNG、WebP 形式のみ対応しています。",
      ),
    );
  }

  return ok({ contentType: format.contentType, extension: format.extension });
};

/**
 * 新しい写真名を生成する。
 *
 * 利用者がアップロードした元のファイル名は使用せず、
 * CUID2 と、検証で決まった形式の拡張子を組み合わせて安全なファイル名を生成する。
 */
export const toFacilityPhotoName = (extension: FacilityPhotoFormat["extension"]): string =>
  `${createId()}.${extension}`;

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
