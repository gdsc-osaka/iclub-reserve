import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import {
  CalendarErrorCode,
  type CalendarClient,
  type CalendarError,
  type CalendarWriteAccess,
} from "~/domain/calendar";
import {
  FacilityErrorCode,
  FacilityField,
  type CreateFacilityInput,
  type Facility,
  type FacilityRepository,
} from "~/domain/facility";
import type { FacilityPhotoStorage } from "~/domain/facility/facility-photo";
import { createFacilityUseCase, type CreateFacilityDeps } from "./create-facility";

/** 先頭のバイトが本物の PNG・JPEG になっている写真（形式は先頭のバイトで判定される） */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1,
]);

const createMockCalendarClient = (
  access: CalendarWriteAccess | "error" = "writable",
  error?: CalendarError,
): CalendarClient => ({
  checkWriteAccess: vi
    .fn()
    .mockImplementation(() =>
      access === "error"
        ? errAsync(error ?? { code: CalendarErrorCode.Unavailable, message: "Unavailable" })
        : okAsync(access),
    ),
  upsertEvent: vi.fn().mockReturnValue(okAsync(null)),
  deleteEvent: vi.fn().mockReturnValue(okAsync(null)),
  listManagedEvents: vi.fn().mockReturnValue(okAsync([])),
});

const mockCreatedFacility = (input: CreateFacilityInput): Facility => ({
  id: input.id ?? "fac_new_01",
  name: input.name,
  description: input.description,
  photoUrl: input.photoUrl,
  googleCalendarId: input.googleCalendarId,
  calendarUrl: input.calendarUrl,
  isActive: input.isActive,
  createdAt: input.createdAt,
  updatedAt: input.updatedAt,
});

const defaultDeps = (overrides: Partial<CreateFacilityDeps> = {}): CreateFacilityDeps => ({
  facilityRepository: {
    create: vi
      .fn()
      .mockImplementation((input: CreateFacilityInput) => okAsync(mockCreatedFacility(input))),
  } as unknown as FacilityRepository,
  facilityPhotoStorage: { put: vi.fn(), delete: vi.fn() } as unknown as FacilityPhotoStorage,
  calendarClient: createMockCalendarClient("writable"),
  calendarWriterEmail: "service-account@example.iam.gserviceaccount.com",
  ...overrides,
});

describe("createFacilityUseCase", () => {
  const now = new Date("2026-10-01T10:00:00Z");

  it("事務局でなければ Forbidden で、R2 にも DB にも触れない", async () => {
    const putMock = vi.fn();
    const createMock = vi.fn();
    const deps = defaultDeps({
      facilityPhotoStorage: { put: putMock, delete: vi.fn() } as unknown as FacilityPhotoStorage,
      facilityRepository: { create: createMock } as unknown as FacilityRepository,
    });

    const result = await createFacilityUseCase(deps, {
      actorUserId: "usr_user_01",
      isStaff: false,
      name: "新施設",
      description: null,
      googleCalendarId: null,
      photo: null,
      isActive: true,
      now,
    });

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
      const deps = defaultDeps();

      const result = await createFacilityUseCase(deps, {
        actorUserId: "usr_staff_01",
        isStaff: true,
        name,
        description: desc,
        googleCalendarId: calId,
        photo,
        isActive: true,
        now,
      });

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(FacilityErrorCode.InvalidInput);
      expect(error.field).toBe(expectedField);
    },
  );

  it("MIME タイプを画像と偽った画像でないファイルは InvalidInput で、R2 に置かない", async () => {
    const putMock = vi.fn();
    const createMock = vi.fn();
    const deps = defaultDeps({
      facilityPhotoStorage: { put: putMock, delete: vi.fn() } as unknown as FacilityPhotoStorage,
      facilityRepository: { create: createMock } as unknown as FacilityRepository,
    });

    const result = await createFacilityUseCase(deps, {
      actorUserId: "usr_staff_01",
      isStaff: true,
      name: "施設名",
      description: null,
      googleCalendarId: null,
      photo: new File(["<html><script>alert(1)</script>"], "photo.png", { type: "image/png" }),
      isActive: true,
      now,
    });

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
    const deps = defaultDeps({
      facilityPhotoStorage: { put: putMock, delete: vi.fn() } as unknown as FacilityPhotoStorage,
      facilityRepository: { create: createMock } as unknown as FacilityRepository,
    });

    const result = await createFacilityUseCase(deps, {
      actorUserId: "usr_staff_01",
      isStaff: true,
      name: "施設名",
      description: null,
      googleCalendarId: null,
      // 中身は PNG だが、名前と MIME タイプは JPEG
      photo: new File([PNG_BYTES], "photo.jpg", { type: "image/jpeg" }),
      isActive: true,
      now,
    });

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

    const deps = defaultDeps({
      facilityPhotoStorage: {
        put: putMock,
        delete: deleteMock,
      } as unknown as FacilityPhotoStorage,
      facilityRepository: {
        create: createMock,
      } as unknown as FacilityRepository,
    });

    const file = new File([PNG_BYTES], "photo.png", { type: "image/png" });

    const result = await createFacilityUseCase(deps, {
      actorUserId: "usr_staff_01",
      isStaff: true,
      name: "吹田：新3Dプリンター",
      description: null,
      googleCalendarId: null,
      photo: file,
      isActive: true,
      now,
    });

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

    const deps = defaultDeps({
      facilityPhotoStorage: {
        put: putMock,
        delete: vi.fn(),
      } as unknown as FacilityPhotoStorage,
      facilityRepository: {
        create: createMock,
      } as unknown as FacilityRepository,
    });

    const file = new File([JPEG_BYTES], "camera.jpg", { type: "image/jpeg" });

    const result = await createFacilityUseCase(deps, {
      actorUserId: "usr_staff_01",
      isStaff: true,
      name: "豊中試作室",
      description: "試作用の部屋です",
      googleCalendarId: "toyonaka@group.calendar.google.com",
      photo: file,
      isActive: true,
      now,
    });

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
      expect.objectContaining({
        action: "facility.create",
        actorId: "usr_staff_01",
        actedAsStaff: true,
        groupId: null,
        targetId: expect.any(String),
        changes: expect.objectContaining({
          name: { before: null, after: "豊中試作室" },
        }),
      }),
    );
  });

  describe("Google Calendar 書き込み権限の確認（COND-025）", () => {
    const validPhoto = new File([PNG_BYTES], "photo.png", { type: "image/png" });

    it("Google Calendar ID が未設定（null）のときは checkWriteAccess を呼ばない", async () => {
      const calendarClient = createMockCalendarClient("writable");
      const deps = defaultDeps({ calendarClient });

      const result = await createFacilityUseCase(deps, {
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "施設名",
        description: null,
        googleCalendarId: null,
        photo: null,
        isActive: true,
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(calendarClient.checkWriteAccess).not.toHaveBeenCalled();
    });

    it("writable の場合は写真を R2 に保存し、施設を登録できる", async () => {
      const putMock = vi.fn().mockReturnValue(okAsync(undefined));
      const createMock = vi
        .fn()
        .mockImplementation((input: CreateFacilityInput) => okAsync(mockCreatedFacility(input)));
      const calendarClient = createMockCalendarClient("writable");

      const deps = defaultDeps({
        facilityPhotoStorage: { put: putMock, delete: vi.fn() } as unknown as FacilityPhotoStorage,
        facilityRepository: { create: createMock } as unknown as FacilityRepository,
        calendarClient,
      });

      const result = await createFacilityUseCase(deps, {
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "施設名",
        description: null,
        googleCalendarId: "valid@group.calendar.google.com",
        photo: validPhoto,
        isActive: true,
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(calendarClient.checkWriteAccess).toHaveBeenCalledWith(
        "valid@group.calendar.google.com",
      );
      expect(putMock).toHaveBeenCalledOnce();
      expect(createMock).toHaveBeenCalledOnce();
    });

    it("not_writable の場合は CalendarNotWritable で止まり、写真を R2 に置かない", async () => {
      const putMock = vi.fn();
      const createMock = vi.fn();
      const calendarClient = createMockCalendarClient("not_writable");

      const deps = defaultDeps({
        facilityPhotoStorage: { put: putMock, delete: vi.fn() } as unknown as FacilityPhotoStorage,
        facilityRepository: { create: createMock } as unknown as FacilityRepository,
        calendarClient,
      });

      const result = await createFacilityUseCase(deps, {
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "施設名",
        description: null,
        googleCalendarId: "no-perm@group.calendar.google.com",
        photo: validPhoto,
        isActive: true,
        now,
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.CalendarNotWritable);
      expect(result._unsafeUnwrapErr().field).toBe(FacilityField.GoogleCalendarId);
      // 写真を R2 に上げる前に止まるため put は呼ばれない
      expect(putMock).not.toHaveBeenCalled();
      expect(createMock).not.toHaveBeenCalled();
    });

    it("not_found の場合も CalendarNotWritable で止まり、写真を R2 に置かない", async () => {
      const putMock = vi.fn();
      const createMock = vi.fn();
      const calendarClient = createMockCalendarClient("not_found");

      const deps = defaultDeps({
        facilityPhotoStorage: { put: putMock, delete: vi.fn() } as unknown as FacilityPhotoStorage,
        facilityRepository: { create: createMock } as unknown as FacilityRepository,
        calendarClient,
      });

      const result = await createFacilityUseCase(deps, {
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "施設名",
        description: null,
        googleCalendarId: "missing@group.calendar.google.com",
        photo: validPhoto,
        isActive: true,
        now,
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.CalendarNotWritable);
      expect(putMock).not.toHaveBeenCalled();
      expect(createMock).not.toHaveBeenCalled();
    });

    it("Google に接続できない（Unavailable）場合は CalendarUnavailable で止まり、写真を R2 に置かない", async () => {
      const putMock = vi.fn();
      const createMock = vi.fn();
      const calendarClient = createMockCalendarClient("error", {
        code: CalendarErrorCode.Unavailable,
        message: "Network error",
      });

      const deps = defaultDeps({
        facilityPhotoStorage: { put: putMock, delete: vi.fn() } as unknown as FacilityPhotoStorage,
        facilityRepository: { create: createMock } as unknown as FacilityRepository,
        calendarClient,
      });

      const result = await createFacilityUseCase(deps, {
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "施設名",
        description: null,
        googleCalendarId: "timeout@group.calendar.google.com",
        photo: validPhoto,
        isActive: true,
        now,
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.CalendarUnavailable);
      expect(putMock).not.toHaveBeenCalled();
      expect(createMock).not.toHaveBeenCalled();
    });
  });
});
