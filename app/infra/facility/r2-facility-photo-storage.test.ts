import { describe, expect, it, vi } from "vitest";
import { FacilityErrorCode } from "~/domain/facility";
import { createR2FacilityPhotoStorage } from "./r2-facility-photo-storage";

describe("createR2FacilityPhotoStorage", () => {
  it("put でキーに facilities/ 接頭辞が付き、ContentType が設定される", async () => {
    const putMock = vi.fn().mockResolvedValue(undefined);
    const fakeBucket = {
      put: putMock,
    } as unknown as R2Bucket;

    const storage = createR2FacilityPhotoStorage(fakeBucket);
    const body = new Uint8Array([1, 2, 3]);
    const result = await storage.put({
      photoName: "k3x9abc123.jpg",
      body,
      contentType: "image/jpeg",
    });

    expect(result.isOk()).toBe(true);
    expect(putMock).toHaveBeenCalledWith(
      "facilities/k3x9abc123.jpg",
      body,
      expect.objectContaining({
        httpMetadata: { contentType: "image/jpeg" },
      }),
    );
  });

  it("put が失敗した場合は PhotoStorageError を返す", async () => {
    const fakeBucket = {
      put: vi.fn().mockRejectedValue(new Error("R2 write error")),
    } as unknown as R2Bucket;

    const storage = createR2FacilityPhotoStorage(fakeBucket);
    const result = await storage.put({
      photoName: "k3x9abc123.jpg",
      body: new Uint8Array(),
      contentType: "image/jpeg",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.PhotoStorageError);
  });

  it("delete でキーに facilities/ 接頭辞が付く", async () => {
    const deleteMock = vi.fn().mockResolvedValue(undefined);
    const fakeBucket = {
      delete: deleteMock,
    } as unknown as R2Bucket;

    const storage = createR2FacilityPhotoStorage(fakeBucket);
    const result = await storage.delete("k3x9abc123.jpg");

    expect(result.isOk()).toBe(true);
    expect(deleteMock).toHaveBeenCalledWith("facilities/k3x9abc123.jpg");
  });

  it("get でキーに facilities/ 接頭辞が付き、オブジェクト情報が返る", async () => {
    const fakeStream = new ReadableStream<Uint8Array>();
    const fakeObject = {
      body: fakeStream,
      httpMetadata: { contentType: "image/png" },
      httpEtag: '"etag-12345"',
    };
    const getMock = vi.fn().mockResolvedValue(fakeObject);
    const fakeBucket = {
      get: getMock,
    } as unknown as R2Bucket;

    const storage = createR2FacilityPhotoStorage(fakeBucket);
    const result = await storage.get("k3x9abc123.png");

    expect(result.isOk()).toBe(true);
    expect(getMock).toHaveBeenCalledWith("facilities/k3x9abc123.png");
    const item = result._unsafeUnwrap();
    expect(item).not.toBeNull();
    expect(item?.contentType).toBe("image/png");
    expect(item?.etag).toBe('"etag-12345"');
    expect(item?.body).toBe(fakeStream);
  });

  it("get でオブジェクトが存在しない場合は null を返す", async () => {
    const fakeBucket = {
      get: vi.fn().mockResolvedValue(null),
    } as unknown as R2Bucket;

    const storage = createR2FacilityPhotoStorage(fakeBucket);
    const result = await storage.get("not-found.jpg");

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });
});
