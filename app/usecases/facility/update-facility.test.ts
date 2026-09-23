import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import {
  FacilityErrorCode,
  type Facility,
  type FacilityRepository,
  type UpdateFacilityInput,
} from "~/domain/facility";
import type { FacilityPhotoStorage } from "~/domain/facility/facility-photo";
import { updateFacilityUseCase } from "./update-facility";

/** 先頭のバイトが本物の PNG・WebP になっている写真（形式は先頭のバイトで判定される） */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe("updateFacilityUseCase", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  const existingFacility: Facility = {
    id: "fac_existing",
    name: "元の名前",
    description: "元の説明",
    photoUrl: "/facility-photos/oldphoto123.jpg",
    googleCalendarId: "old_cal@google.com",
    calendarUrl: "https://calendar.google.com/calendar/ical/old_cal%40google.com/public/basic.ics",
    isActive: true,
    createdAt: new Date("2026-04-01T00:00:00Z"),
    updatedAt: new Date("2026-04-01T00:00:00Z"),
  };

  it("事務局スタッフでなければ Forbidden になる", async () => {
    const facilityPhotoStorage = {} as unknown as FacilityPhotoStorage;
    const facilityRepository = {} as unknown as FacilityRepository;

    const result = await updateFacilityUseCase(
      { facilityRepository, facilityPhotoStorage },
      {
        facilityId: "fac_existing",
        actorUserId: "usr_user_01",
        isStaff: false,
        name: "新しい名前",
        description: null,
        googleCalendarId: null,
        photo: null,
        removePhoto: false,
        now,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.Forbidden);
  });

  it("写真の差し替え時、新しい写真を保存し、更新成功後に古い写真を削除する", async () => {
    const findByIdMock = vi.fn().mockReturnValue(okAsync(existingFacility));
    const updateMock = vi
      .fn()
      .mockImplementation((input: UpdateFacilityInput) =>
        okAsync({ ...existingFacility, ...input }),
      );
    const putMock = vi.fn().mockReturnValue(okAsync(undefined));
    const deleteMock = vi.fn().mockReturnValue(okAsync(undefined));

    const facilityRepository = {
      findById: findByIdMock,
      update: updateMock,
    } as unknown as FacilityRepository;
    const facilityPhotoStorage = {
      put: putMock,
      delete: deleteMock,
    } as unknown as FacilityPhotoStorage;

    const newPhoto = new File([PNG_BYTES], "new.png", { type: "image/png" });

    const result = await updateFacilityUseCase(
      { facilityRepository, facilityPhotoStorage },
      {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "更新後の名前",
        description: "更新後の説明",
        googleCalendarId: "new_cal@google.com",
        photo: newPhoto,
        removePhoto: false,
        now,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(putMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "fac_existing",
        name: "更新後の名前",
        photoUrl: expect.stringMatching(/^\/facility-photos\/[a-z0-9]+\.png$/),
      }),
    );
    // 古い写真の削除が呼ばれたこと
    expect(deleteMock).toHaveBeenCalledWith("oldphoto123.jpg");
  });

  it("写真を取り外す場合（removePhoto: true）、photoUrl を null にし古い写真を削除する", async () => {
    const findByIdMock = vi.fn().mockReturnValue(okAsync(existingFacility));
    const updateMock = vi
      .fn()
      .mockImplementation((input: UpdateFacilityInput) =>
        okAsync({ ...existingFacility, ...input }),
      );
    const deleteMock = vi.fn().mockReturnValue(okAsync(undefined));

    const facilityRepository = {
      findById: findByIdMock,
      update: updateMock,
    } as unknown as FacilityRepository;
    const facilityPhotoStorage = {
      delete: deleteMock,
    } as unknown as FacilityPhotoStorage;

    const result = await updateFacilityUseCase(
      { facilityRepository, facilityPhotoStorage },
      {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "更新後の名前",
        description: null,
        googleCalendarId: null,
        photo: null,
        removePhoto: true,
        now,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        photoUrl: null,
      }),
    );
    expect(deleteMock).toHaveBeenCalledWith("oldphoto123.jpg");
  });

  it("写真そのまま（photo: null, removePhoto: false）の場合、既存の photoUrl を維持し削除は呼ばれない", async () => {
    const findByIdMock = vi.fn().mockReturnValue(okAsync(existingFacility));
    const updateMock = vi
      .fn()
      .mockImplementation((input: UpdateFacilityInput) =>
        okAsync({ ...existingFacility, ...input }),
      );
    const deleteMock = vi.fn();

    const facilityRepository = {
      findById: findByIdMock,
      update: updateMock,
    } as unknown as FacilityRepository;
    const facilityPhotoStorage = {
      delete: deleteMock,
    } as unknown as FacilityPhotoStorage;

    const result = await updateFacilityUseCase(
      { facilityRepository, facilityPhotoStorage },
      {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "名前だけ更新",
        description: "説明だけ更新",
        googleCalendarId: "old_cal@google.com",
        photo: null,
        removePhoto: false,
        now,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        photoUrl: "/facility-photos/oldphoto123.jpg",
      }),
    );
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("古い写真の削除が失敗しても操作全体は成功として返す", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const findByIdMock = vi.fn().mockReturnValue(okAsync(existingFacility));
    const updateMock = vi
      .fn()
      .mockImplementation((input: UpdateFacilityInput) =>
        okAsync({ ...existingFacility, ...input }),
      );
    const deleteMock = vi.fn().mockReturnValue(
      errAsync({
        code: FacilityErrorCode.PhotoStorageError,
        message: "R2 delete failed",
      }),
    );

    const facilityRepository = {
      findById: findByIdMock,
      update: updateMock,
    } as unknown as FacilityRepository;
    const facilityPhotoStorage = {
      delete: deleteMock,
    } as unknown as FacilityPhotoStorage;

    const result = await updateFacilityUseCase(
      { facilityRepository, facilityPhotoStorage },
      {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "名前",
        description: null,
        googleCalendarId: null,
        photo: null,
        removePhoto: true,
        now,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(deleteMock).toHaveBeenCalledWith("oldphoto123.jpg");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("DB 更新が失敗したら、新しく置いた写真を削除してロールバックする", async () => {
    const findByIdMock = vi.fn().mockReturnValue(okAsync(existingFacility));
    const putMock = vi.fn().mockReturnValue(okAsync(undefined));
    const deleteMock = vi.fn().mockReturnValue(okAsync(undefined));
    const updateMock = vi.fn().mockReturnValue(
      errAsync({
        code: FacilityErrorCode.DatabaseError,
        message: "DB update error",
      }),
    );

    const facilityRepository = {
      findById: findByIdMock,
      update: updateMock,
    } as unknown as FacilityRepository;
    const facilityPhotoStorage = {
      put: putMock,
      delete: deleteMock,
    } as unknown as FacilityPhotoStorage;

    const newPhoto = new File([WEBP_BYTES], "new.webp", { type: "image/webp" });

    const result = await updateFacilityUseCase(
      { facilityRepository, facilityPhotoStorage },
      {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "名前",
        description: null,
        googleCalendarId: null,
        photo: newPhoto,
        removePhoto: false,
        now,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.DatabaseError);
    // 新しくアップロードした写真の削除が呼ばれたこと
    expect(deleteMock).toHaveBeenCalledWith(expect.stringMatching(/^[a-z0-9]+\.webp$/));
  });

  it("読んだときの写真の URL を、更新の条件（expectedPhotoUrl）として渡す", async () => {
    const updateMock = vi
      .fn()
      .mockImplementation((input: UpdateFacilityInput) =>
        okAsync({ ...existingFacility, ...input }),
      );
    const facilityRepository = {
      findById: vi.fn().mockReturnValue(okAsync(existingFacility)),
      update: updateMock,
    } as unknown as FacilityRepository;
    const facilityPhotoStorage = {} as unknown as FacilityPhotoStorage;

    await updateFacilityUseCase(
      { facilityRepository, facilityPhotoStorage },
      {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "名前だけ変える",
        description: null,
        googleCalendarId: null,
        photo: null,
        removePhoto: false,
        now,
      },
    );

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        photoUrl: "/facility-photos/oldphoto123.jpg",
        expectedPhotoUrl: "/facility-photos/oldphoto123.jpg",
      }),
    );
  });

  it("別の人が先に写真を変えていて Conflict になったら、新しい写真だけを片付け、古い写真は消さない", async () => {
    const deleteMock = vi.fn().mockReturnValue(okAsync(undefined));
    const facilityRepository = {
      findById: vi.fn().mockReturnValue(okAsync(existingFacility)),
      update: vi.fn().mockReturnValue(
        errAsync({
          code: FacilityErrorCode.Conflict,
          message: "写真が先に変わっていた",
          userMessage: "ほかの人が同時にこの施設を更新しました。",
        }),
      ),
    } as unknown as FacilityRepository;
    const facilityPhotoStorage = {
      put: vi.fn().mockReturnValue(okAsync(undefined)),
      delete: deleteMock,
    } as unknown as FacilityPhotoStorage;

    const result = await updateFacilityUseCase(
      { facilityRepository, facilityPhotoStorage },
      {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "名前",
        description: null,
        googleCalendarId: null,
        photo: new File([PNG_BYTES], "new.png", { type: "image/png" }),
        removePhoto: false,
        now,
      },
    );

    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.Conflict);
    expect(deleteMock).toHaveBeenCalledOnce();
    expect(deleteMock).toHaveBeenCalledWith(expect.stringMatching(/^[a-z0-9]+\.png$/));
    expect(deleteMock).not.toHaveBeenCalledWith("oldphoto123.jpg");
  });

  it("Google Calendar ID を空にすると google_calendar_id と calendar_url の両方が null になる", async () => {
    const findByIdMock = vi.fn().mockReturnValue(okAsync(existingFacility));
    const updateMock = vi
      .fn()
      .mockImplementation((input: UpdateFacilityInput) =>
        okAsync({ ...existingFacility, ...input }),
      );

    const facilityRepository = {
      findById: findByIdMock,
      update: updateMock,
    } as unknown as FacilityRepository;
    const facilityPhotoStorage = {} as unknown as FacilityPhotoStorage;

    const result = await updateFacilityUseCase(
      { facilityRepository, facilityPhotoStorage },
      {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "名前",
        description: null,
        googleCalendarId: "",
        photo: null,
        removePhoto: false,
        now,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        googleCalendarId: null,
        calendarUrl: null,
      }),
    );
  });
});
