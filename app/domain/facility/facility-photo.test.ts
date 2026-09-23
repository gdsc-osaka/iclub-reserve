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

describe("validateFacilityPhoto", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])(
    "対応形式（%s）かつ許容サイズなら ok で拡張子が返る",
    (type) => {
      const result = validateFacilityPhoto({ type, size: 1024 * 1024 });
      expect(result.isOk()).toBe(true);
      expect(typeof result._unsafeUnwrap().extension).toBe("string");
    },
  );

  it.each(["image/gif", "image/svg+xml", "application/pdf", "text/plain"])(
    "非対応形式（%s）は InvalidInput になる",
    (type) => {
      const result = validateFacilityPhoto({ type, size: 1024 });
      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(FacilityErrorCode.InvalidInput);
      expect(error.field).toBe(FacilityField.Photo);
      expect(error.userMessage).toBe("写真は JPEG、PNG、WebP 形式のみ対応しています。");
    },
  );

  it("上限ちょうど（5 MiB）の写真は通る", () => {
    const result = validateFacilityPhoto({
      type: "image/jpeg",
      size: FACILITY_PHOTO_MAX_BYTES,
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().extension).toBe("jpg");
  });

  it("上限+1（5 MiB + 1 Byte）の写真は InvalidInput になる", () => {
    const result = validateFacilityPhoto({
      type: "image/jpeg",
      size: FACILITY_PHOTO_MAX_BYTES + 1,
    });
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.InvalidInput);
    expect(error.field).toBe(FacilityField.Photo);
    expect(error.userMessage).toBe("写真は 5 MiB 以内のものを選択してください。");
  });

  it.each([0, -1])("0 バイト以下（%d）の写真は InvalidInput になる", (size) => {
    const result = validateFacilityPhoto({ type: "image/png", size });
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.InvalidInput);
    expect(error.field).toBe(FacilityField.Photo);
    expect(error.userMessage).toBe("写真ファイルを選択してください。");
  });
});

describe("toFacilityPhotoName", () => {
  it.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ])("MIME タイプ %s から適切な拡張子を持つ写真名を生成する", (mime, ext) => {
    const result = toFacilityPhotoName(mime);
    expect(result.isOk()).toBe(true);
    const photoName = result._unsafeUnwrap();
    expect(isFacilityPhotoName(photoName)).toBe(true);
    expect(photoName.endsWith(`.${ext}`)).toBe(true);
  });

  it("非対応の MIME タイプは InvalidInput になる", () => {
    const result = toFacilityPhotoName("image/bmp");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.InvalidInput);
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
