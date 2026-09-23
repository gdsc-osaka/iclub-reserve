import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import {
  FacilityErrorCode,
  FacilityField,
  type CreateFacilityInput,
  type Facility,
  type FacilityRepository,
} from "~/domain/facility";
import type { FacilityPhotoStorage } from "~/domain/facility/facility-photo";
import { createFacilityUseCase } from "./create-facility";

/** 先頭のバイトが本物の PNG・JPEG になっている写真（形式は先頭のバイトで判定される） */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1,
]);

describe("createFacilityUseCase", () => {
  const now = new Date("2026-10-01T10:00:00Z");

  const mockCreatedFacility = (input: CreateFacilityInput): Facility => ({
    id: "fac_new_01",
    name: input.name,
    description: input.description,
    photoUrl: input.photoUrl,
    googleCalendarId: input.googleCalendarId,
    calendarUrl: input.calendarUrl,
    isActive: input.isActive,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });

  it("事務局でなければ Forbidden で、R2 にも DB にも触れない", async () => {
    const putMock = vi.fn();
    const createMock = vi.fn();
    const facilityPhotoStorage = { put: putMock } as unknown as FacilityPhotoStorage;
    const facilityRepository = { create: createMock } as unknown as FacilityRepository;

    const result = await createFacilityUseCase(
      { facilityRepository, facilityPhotoStorage },
      {
        actorUserId: "usr_user_01",
        isStaff: false,
        name: "新施設",
        description: null,
        googleCalendarId: null,
        photo: null,
        isActive: true,
        now,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.Forbidden);
    expect(putMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "",
      desc: null,
      calId: null,
      photo: null,
      expectedField: FacilityField.Name,
    },
    {
      name: "施設名",
      desc: "a".repeat(1001),
      calId: null,
      photo: null,
      expectedField: FacilityField.Description,
    },
    {
      name: "施設名",
      desc: null,
      calId: "invalid-cal-no-at",
      photo: null,
      expectedField: FacilityField.GoogleCalendarId,
    },
    {
      name: "施設名",
      desc: null,
      calId: null,
      photo: new File(["content"], "test.gif", { type: "image/gif" }),
      expectedField: FacilityField.Photo,
    },
  ])(
    "検証エラー時に適切な field（$expectedField）が付与される",
    async ({ name, desc, calId, photo, expectedField }) => {
      const facilityPhotoStorage = { put: vi.fn() } as unknown as FacilityPhotoStorage;
      const facilityRepository = { create: vi.fn() } as unknown as FacilityRepository;

      const result = await createFacilityUseCase(
        { facilityRepository, facilityPhotoStorage },
        {
          actorUserId: "usr_staff_01",
          isStaff: true,
          name,
          description: desc,
          googleCalendarId: calId,
          photo,
          isActive: true,
          now,
        },
      );

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(FacilityErrorCode.InvalidInput);
      expect(error.field).toBe(expectedField);
    },
  );

  it("MIME タイプを画像と偽った画像でないファイルは InvalidInput で、R2 に置かない", async () => {
    const putMock = vi.fn();
    const createMock = vi.fn();
    const facilityPhotoStorage = { put: putMock } as unknown as FacilityPhotoStorage;
    const facilityRepository = { create: createMock } as unknown as FacilityRepository;

    const result = await createFacilityUseCase(
      { facilityRepository, facilityPhotoStorage },
      {
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "施設名",
        description: null,
        googleCalendarId: null,
        photo: new File(["<html><script>alert(1)</script>"], "photo.png", { type: "image/png" }),
        isActive: true,
        now,
      },
    );

    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.InvalidInput);
    expect(error.field).toBe(FacilityField.Photo);
    expect(putMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("拡張子と中身が違う写真は、中身の形式の Content-Type と拡張子で保存する", async () => {
    const putMock = vi.fn().mockReturnValue(okAsync(undefined));
    const createMock = vi
      .fn()
      .mockImplementation((input: CreateFacilityInput) => okAsync(mockCreatedFacility(input)));
    const facilityPhotoStorage = { put: putMock } as unknown as FacilityPhotoStorage;
    const facilityRepository = { create: createMock } as unknown as FacilityRepository;

    const result = await createFacilityUseCase(
      { facilityRepository, facilityPhotoStorage },
      {
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "施設名",
        description: null,
        googleCalendarId: null,
        // 中身は PNG だが、名前と MIME タイプは JPEG
        photo: new File([PNG_BYTES], "photo.jpg", { type: "image/jpeg" }),
        isActive: true,
        now,
      },
    );

    expect(result._unsafeUnwrap().photoUrl).toMatch(/^\/facility-photos\/[a-z0-9]+\.png$/);
    expect(putMock).toHaveBeenCalledWith(
      expect.objectContaining({
        photoName: expect.stringMatching(/^[a-z0-9]+\.png$/),
        contentType: "image/png",
      }),
    );
  });

  it("写真を置いた後 DB 登録が失敗したら、アップロードした写真を削除してロールバックする", async () => {
    const putMock = vi.fn().mockReturnValue(okAsync(undefined));
    const deleteMock = vi.fn().mockReturnValue(okAsync(undefined));
    const createMock = vi.fn().mockReturnValue(
      errAsync({
        code: FacilityErrorCode.DatabaseError,
        message: "DB error",
      }),
    );

    const facilityPhotoStorage = {
      put: putMock,
      delete: deleteMock,
    } as unknown as FacilityPhotoStorage;
    const facilityRepository = {
      create: createMock,
    } as unknown as FacilityRepository;

    const file = new File([PNG_BYTES], "photo.png", { type: "image/png" });

    const result = await createFacilityUseCase(
      { facilityRepository, facilityPhotoStorage },
      {
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "吹田：新3Dプリンター",
        description: null,
        googleCalendarId: null,
        photo: file,
        isActive: true,
        now,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.DatabaseError);
    expect(putMock).toHaveBeenCalledOnce();
    expect(createMock).toHaveBeenCalledOnce();
    // ロールバックの削除が呼ばれたこと
    expect(deleteMock).toHaveBeenCalledWith(expect.stringMatching(/^[a-z0-9]+\.png$/));
  });

  it("成功時にカレンダー URL が自動生成され、正常に登録される", async () => {
    const putMock = vi.fn().mockReturnValue(okAsync(undefined));
    const createMock = vi
      .fn()
      .mockImplementation((input: CreateFacilityInput) => okAsync(mockCreatedFacility(input)));

    const facilityPhotoStorage = {
      put: putMock,
      delete: vi.fn(),
    } as unknown as FacilityPhotoStorage;
    const facilityRepository = {
      create: createMock,
    } as unknown as FacilityRepository;

    const file = new File([JPEG_BYTES], "camera.jpg", { type: "image/jpeg" });

    const result = await createFacilityUseCase(
      { facilityRepository, facilityPhotoStorage },
      {
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "豊中試作室",
        description: "試作用の部屋です",
        googleCalendarId: "toyonaka@group.calendar.google.com",
        photo: file,
        isActive: true,
        now,
      },
    );

    expect(result.isOk()).toBe(true);
    const facility = result._unsafeUnwrap();
    expect(facility.name).toBe("豊中試作室");
    expect(facility.calendarUrl).toBe(
      "https://calendar.google.com/calendar/ical/toyonaka%40group.calendar.google.com/public/basic.ics",
    );
    expect(facility.photoUrl).toMatch(/^\/facility-photos\/[a-z0-9]+\.jpg$/);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "豊中試作室",
        description: "試作用の部屋です",
        googleCalendarId: "toyonaka@group.calendar.google.com",
        calendarUrl:
          "https://calendar.google.com/calendar/ical/toyonaka%40group.calendar.google.com/public/basic.ics",
        isActive: true,
      }),
    );
  });
});
