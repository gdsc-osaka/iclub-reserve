import { describe, expect, it } from "vitest";
import {
  FACILITY_PHOTO_MAX_BYTES,
  isFacilityPhotoName,
  toFacilityPhotoName,
  toFacilityPhotoNameFromUrl,
  toFacilityPhotoUrl,
  validateFacilityPhoto,
} from "./facility-photo";
import { FacilityErrorCode, FacilityField } from "./index";

/** 文字列を ASCII のバイト列にする */
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

/** 各形式の先頭 12 バイト */
const JPEG_HEAD = new Uint8Array([
  0xff,
  0xd8,
  0xff,
  0xe0,
  0x00,
  0x10,
  ...ascii("JFIF"),
  0x00,
  0x01,
]);
const PNG_HEAD = new Uint8Array([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP_HEAD = new Uint8Array([...ascii("RIFF"), 0x24, 0x00, 0x00, 0x00, ...ascii("WEBP")]);

describe("validateFacilityPhoto", () => {
  it.each([
    ["JPEG", JPEG_HEAD, "image/jpeg", "jpg"],
    ["PNG", PNG_HEAD, "image/png", "png"],
    ["WebP", WEBP_HEAD, "image/webp", "webp"],
  ])("先頭のバイトが %s なら、その形式の Content-Type と拡張子を返す", (_, head, type, ext) => {
    const result = validateFacilityPhoto({ size: 1024 * 1024, head });
    expect(result._unsafeUnwrap()).toEqual({ contentType: type, extension: ext });
  });

  it.each([
    ["GIF", new Uint8Array(ascii("GIF89a\x01\x00\x01\x00\x00\x00"))],
    ["SVG", new Uint8Array(ascii('<svg xmlns="'))],
    ["PDF", new Uint8Array(ascii("%PDF-1.7\n%\xe2\xe3"))],
    ["HEIC", new Uint8Array([0x00, 0x00, 0x00, 0x18, ...ascii("ftypheic")])],
    [
      "RIFF だが WebP でない（WAV）",
      new Uint8Array([...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WAVE")]),
    ],
    ["JPEG の先頭 2 バイトだけ", new Uint8Array([0xff, 0xd8])],
    ["空", new Uint8Array([])],
  ])("先頭のバイトが対応形式に当たらない（%s）なら InvalidInput になる", (_, head) => {
    const result = validateFacilityPhoto({ size: 1024, head });
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.InvalidInput);
    expect(error.field).toBe(FacilityField.Photo);
    expect(error.userMessage).toBe("写真は JPEG、PNG、WebP 形式のみ対応しています。");
  });

  it("上限ちょうど（5 MiB）の写真は通る", () => {
    const result = validateFacilityPhoto({ size: FACILITY_PHOTO_MAX_BYTES, head: JPEG_HEAD });
    expect(result._unsafeUnwrap().extension).toBe("jpg");
  });

  it("上限+1（5 MiB + 1 Byte）の写真は InvalidInput になる", () => {
    const result = validateFacilityPhoto({ size: FACILITY_PHOTO_MAX_BYTES + 1, head: JPEG_HEAD });
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.InvalidInput);
    expect(error.field).toBe(FacilityField.Photo);
    expect(error.userMessage).toBe("写真は 5 MiB 以内のものを選択してください。");
  });

  it.each([0, -1])("0 バイト以下（%d）の写真は InvalidInput になる", (size) => {
    const result = validateFacilityPhoto({ size, head: PNG_HEAD });
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.InvalidInput);
    expect(error.field).toBe(FacilityField.Photo);
    expect(error.userMessage).toBe("写真ファイルを選択してください。");
  });
});

describe("toFacilityPhotoName", () => {
  it.each(["jpg", "png", "webp"] as const)(
    "拡張子 %s の付いた、配信ルートが受け付ける写真名を作る",
    (ext) => {
      const photoName = toFacilityPhotoName(ext);
      expect(isFacilityPhotoName(photoName)).toBe(true);
      expect(photoName.endsWith(`.${ext}`)).toBe(true);
    },
  );

  it("呼ぶたびに違う写真名を作る", () => {
    expect(toFacilityPhotoName("jpg")).not.toBe(toFacilityPhotoName("jpg"));
  });
});

describe("toFacilityPhotoUrl / toFacilityPhotoNameFromUrl", () => {
  it("写真名と配信 URL の相互変換が一致する", () => {
    const photoName = "k3x9abc123.jpg";
    const url = toFacilityPhotoUrl(photoName);
    expect(url).toBe(`/facility-photos/${photoName}`);
    expect(toFacilityPhotoNameFromUrl(url)).toBe(photoName);
  });

  it.each([
    null,
    undefined,
    "",
    "/other-photos/k3x9abc123.jpg",
    "/facility-photos/../k3x9abc123.jpg",
    "/facility-photos/k3x9abc123.gif",
    "/facility-photos/INVALID.JPG",
    "http://example.com/facility-photos/k3x9abc123.jpg",
  ])("不正または合致しない URL（%o）は null を返す", (invalidUrl) => {
    expect(toFacilityPhotoNameFromUrl(invalidUrl)).toBeNull();
  });
});

describe("isFacilityPhotoName", () => {
  it.each(["k3x9abc123.jpg", "abcdef0123456789.png", "test1234.webp"])(
    "正当な写真名（%s）は true を返す",
    (name) => {
      expect(isFacilityPhotoName(name)).toBe(true);
    },
  );

  it.each([
    "../facilities/x.jpg",
    "facilities/x.jpg",
    "/k3x9abc123.jpg",
    "k3x9abc123.JPG",
    "ABC123.jpg",
    "photo.gif",
    "photo.svg",
    "photo.jpeg",
    "photo",
    ".jpg",
    "photo.jpg.exe",
    "",
  ])("不正な写真名（%s）は false を返す", (invalidName) => {
    expect(isFacilityPhotoName(invalidName)).toBe(false);
  });
});
