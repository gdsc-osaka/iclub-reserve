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
  type Facility,
  type FacilityRepository,
  type UpdateFacilityInput,
} from "~/domain/facility";
import type { FacilityPhotoStorage } from "~/domain/facility/facility-photo";
import { updateFacilityUseCase, type UpdateFacilityDeps } from "./update-facility";

/** 先頭のバイトが本物の PNG・WebP になっている写真（形式は先頭のバイトで判定される） */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
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

  const defaultDeps = (
    overrides: Partial<{
      facilityRepository: Partial<FacilityRepository>;
      facilityPhotoStorage: Partial<FacilityPhotoStorage>;
      calendarClient: CalendarClient;
      calendarWriterEmail: string | null;
    }> = {},
  ): UpdateFacilityDeps => ({
    facilityRepository: {
      findById: vi.fn().mockReturnValue(okAsync(existingFacility)),
      update: vi
        .fn()
        .mockImplementation((input: UpdateFacilityInput) =>
          okAsync({ ...existingFacility, ...input }),
        ),
      ...overrides.facilityRepository,
    } as unknown as FacilityRepository,
    facilityPhotoStorage: {
      put: vi.fn().mockReturnValue(okAsync(undefined)),
      delete: vi.fn().mockReturnValue(okAsync(undefined)),
      ...overrides.facilityPhotoStorage,
    } as unknown as FacilityPhotoStorage,
    calendarClient: overrides.calendarClient ?? createMockCalendarClient("writable"),
    calendarWriterEmail:
      overrides.calendarWriterEmail !== undefined
        ? overrides.calendarWriterEmail
        : "service-account@example.com",
  });

  it("事務局スタッフでなければ Forbidden になる", async () => {
    const deps = defaultDeps();

    const result = await updateFacilityUseCase(deps, {
      facilityId: "fac_existing",
      actorUserId: "usr_user_01",
      isStaff: false,
      name: "新しい名前",
      description: null,
      googleCalendarId: null,
      photo: null,
      removePhoto: false,
      now,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.Forbidden);
  });

  it("写真の差し替え時、新しい写真を保存し、更新成功後に古い写真を削除する", async () => {
    const putMock = vi.fn().mockReturnValue(okAsync(undefined));
    const deleteMock = vi.fn().mockReturnValue(okAsync(undefined));
    const updateMock = vi
      .fn()
      .mockImplementation((input: UpdateFacilityInput) =>
        okAsync({ ...existingFacility, ...input }),
      );

    const deps = defaultDeps({
      facilityRepository: { update: updateMock },
      facilityPhotoStorage: { put: putMock, delete: deleteMock },
    });

    const newPhoto = new File([PNG_BYTES], "new.png", { type: "image/png" });

    const result = await updateFacilityUseCase(deps, {
      facilityId: "fac_existing",
      actorUserId: "usr_staff_01",
      isStaff: true,
      name: "更新後の名前",
      description: "更新後の説明",
      googleCalendarId: "new_cal@google.com",
      photo: newPhoto,
      removePhoto: false,
      now,
    });

    expect(result.isOk()).toBe(true);
    expect(putMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "fac_existing",
        name: "更新後の名前",
        photoUrl: expect.stringMatching(/^\/facility-photos\/[a-z0-9]+\.png$/),
      }),
      expect.objectContaining({
        action: "facility.update",
        actorId: "usr_staff_01",
        actedAsStaff: true,
        targetId: "fac_existing",
      }),
      expect.objectContaining({
        rangeStart: expect.any(Date),
      }),
    );
    // 古い写真の削除が呼ばれたこと
    expect(deleteMock).toHaveBeenCalledWith("oldphoto123.jpg");
  });

  it("写真を取り外す場合（removePhoto: true）、photoUrl を null にし古い写真を削除する", async () => {
    const updateMock = vi
      .fn()
      .mockImplementation((input: UpdateFacilityInput) =>
        okAsync({ ...existingFacility, ...input }),
      );
    const deleteMock = vi.fn().mockReturnValue(okAsync(undefined));

    const deps = defaultDeps({
      facilityRepository: { update: updateMock },
      facilityPhotoStorage: { delete: deleteMock },
    });

    const result = await updateFacilityUseCase(deps, {
      facilityId: "fac_existing",
      actorUserId: "usr_staff_01",
      isStaff: true,
      name: "更新後の名前",
      description: null,
      googleCalendarId: null,
      photo: null,
      removePhoto: true,
      now,
    });

    expect(result.isOk()).toBe(true);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        photoUrl: null,
      }),
      expect.objectContaining({
        action: "facility.update",
        targetId: "fac_existing",
      }),
      expect.objectContaining({
        rangeStart: expect.any(Date),
      }),
    );
    expect(deleteMock).toHaveBeenCalledWith("oldphoto123.jpg");
  });

  it("写真そのまま（photo: null, removePhoto: false）の場合、既存の photoUrl を維持し削除は呼ばれない", async () => {
    const updateMock = vi
      .fn()
      .mockImplementation((input: UpdateFacilityInput) =>
        okAsync({ ...existingFacility, ...input }),
      );
    const deleteMock = vi.fn();

    const deps = defaultDeps({
      facilityRepository: { update: updateMock },
      facilityPhotoStorage: { delete: deleteMock },
    });

    const result = await updateFacilityUseCase(deps, {
      facilityId: "fac_existing",
      actorUserId: "usr_staff_01",
      isStaff: true,
      name: "名前だけ更新",
      description: "説明だけ更新",
      googleCalendarId: "old_cal@google.com",
      photo: null,
      removePhoto: false,
      now,
    });

    expect(result.isOk()).toBe(true);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        photoUrl: "/facility-photos/oldphoto123.jpg",
      }),
      expect.objectContaining({
        action: "facility.update",
        targetId: "fac_existing",
      }),
      expect.objectContaining({
        rangeStart: expect.any(Date),
      }),
    );
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("古い写真の削除が失敗しても操作全体は成功として返す", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deleteMock = vi.fn().mockReturnValue(
      errAsync({
        code: FacilityErrorCode.PhotoStorageError,
        message: "R2 delete failed",
      }),
    );

    const deps = defaultDeps({
      facilityPhotoStorage: { delete: deleteMock },
    });

    const result = await updateFacilityUseCase(deps, {
      facilityId: "fac_existing",
      actorUserId: "usr_staff_01",
      isStaff: true,
      name: "名前",
      description: null,
      googleCalendarId: null,
      photo: null,
      removePhoto: true,
      now,
    });

    expect(result.isOk()).toBe(true);
    expect(deleteMock).toHaveBeenCalledWith("oldphoto123.jpg");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("DB 更新が失敗したら、新しく置いた写真を削除してロールバックする", async () => {
    const putMock = vi.fn().mockReturnValue(okAsync(undefined));
    const deleteMock = vi.fn().mockReturnValue(okAsync(undefined));
    const updateMock = vi.fn().mockReturnValue(
      errAsync({
        code: FacilityErrorCode.DatabaseError,
        message: "DB update error",
      }),
    );

    const deps = defaultDeps({
      facilityRepository: { update: updateMock },
      facilityPhotoStorage: { put: putMock, delete: deleteMock },
    });

    const newPhoto = new File([WEBP_BYTES], "new.webp", { type: "image/webp" });

    const result = await updateFacilityUseCase(deps, {
      facilityId: "fac_existing",
      actorUserId: "usr_staff_01",
      isStaff: true,
      name: "名前",
      description: null,
      googleCalendarId: null,
      photo: newPhoto,
      removePhoto: false,
      now,
    });

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
    const deps = defaultDeps({
      facilityRepository: { update: updateMock },
    });

    await updateFacilityUseCase(deps, {
      facilityId: "fac_existing",
      actorUserId: "usr_staff_01",
      isStaff: true,
      name: "名前だけ変える",
      description: null,
      googleCalendarId: "old_cal@google.com",
      photo: null,
      removePhoto: false,
      now,
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        photoUrl: "/facility-photos/oldphoto123.jpg",
        expectedPhotoUrl: "/facility-photos/oldphoto123.jpg",
      }),
      expect.objectContaining({
        action: "facility.update",
        targetId: "fac_existing",
      }),
      expect.objectContaining({
        rangeStart: expect.any(Date),
      }),
    );
  });

  it("別の人が先に写真を変えていて Conflict になったら、新しい写真だけを片付け、古い写真は消さない", async () => {
    const deleteMock = vi.fn().mockReturnValue(okAsync(undefined));
    const deps = defaultDeps({
      facilityRepository: {
        update: vi.fn().mockReturnValue(
          errAsync({
            code: FacilityErrorCode.Conflict,
            message: "写真が先に変わっていた",
            userMessage: "ほかの人が同時にこの施設を更新しました。",
          }),
        ),
      },
      facilityPhotoStorage: {
        put: vi.fn().mockReturnValue(okAsync(undefined)),
        delete: deleteMock,
      },
    });

    const result = await updateFacilityUseCase(deps, {
      facilityId: "fac_existing",
      actorUserId: "usr_staff_01",
      isStaff: true,
      name: "名前",
      description: null,
      googleCalendarId: null,
      photo: new File([PNG_BYTES], "new.png", { type: "image/png" }),
      removePhoto: false,
      now,
    });

    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.Conflict);
    expect(deleteMock).toHaveBeenCalledOnce();
    expect(deleteMock).toHaveBeenCalledWith(expect.stringMatching(/^[a-z0-9]+\.png$/));
    expect(deleteMock).not.toHaveBeenCalledWith("oldphoto123.jpg");
  });

  it("Google Calendar ID を空にすると google_calendar_id と calendar_url の両方が null になる", async () => {
    const updateMock = vi
      .fn()
      .mockImplementation((input: UpdateFacilityInput) =>
        okAsync({ ...existingFacility, ...input }),
      );
    const deps = defaultDeps({
      facilityRepository: { update: updateMock },
    });

    const result = await updateFacilityUseCase(deps, {
      facilityId: "fac_existing",
      actorUserId: "usr_staff_01",
      isStaff: true,
      name: "元の名前",
      description: null,
      googleCalendarId: "",
      photo: null,
      removePhoto: false,
      now,
    });

    expect(result.isOk()).toBe(true);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        googleCalendarId: null,
        calendarUrl: null,
      }),
      expect.objectContaining({
        action: "facility.update",
        targetId: "fac_existing",
      }),
      null,
    );
  });

  it("変更差分が無い場合、DB 更新を行わずに成功する（COND-013）", async () => {
    const updateMock = vi.fn();
    const deps = defaultDeps({
      facilityRepository: { update: updateMock },
    });

    const result = await updateFacilityUseCase(deps, {
      facilityId: "fac_existing",
      actorUserId: "usr_staff_01",
      isStaff: true,
      name: existingFacility.name,
      description: existingFacility.description,
      googleCalendarId: existingFacility.googleCalendarId,
      photo: null,
      removePhoto: false,
      now,
    });

    expect(result.isOk()).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  describe("COND-025: Google Calendar ID の書き込み確認", () => {
    it("Google Calendar ID を変更しない場合、checkWriteAccess は呼ばれない", async () => {
      const calendarClient = createMockCalendarClient("writable");
      const deps = defaultDeps({ calendarClient });

      const result = await updateFacilityUseCase(deps, {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "新しい名前",
        description: null,
        googleCalendarId: existingFacility.googleCalendarId, // 変更なし
        photo: null,
        removePhoto: false,
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(calendarClient.checkWriteAccess).not.toHaveBeenCalled();
    });

    it("Google Calendar ID を空にする場合、checkWriteAccess は呼ばれない", async () => {
      const calendarClient = createMockCalendarClient("writable");
      const deps = defaultDeps({ calendarClient });

      const result = await updateFacilityUseCase(deps, {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "元の名前",
        description: null,
        googleCalendarId: "", // 空文字 -> null
        photo: null,
        removePhoto: false,
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(calendarClient.checkWriteAccess).not.toHaveBeenCalled();
    });

    it("新しい Calendar ID に書き込み権限がある（writable）場合、正常に更新される", async () => {
      const calendarClient = createMockCalendarClient("writable");
      const deps = defaultDeps({ calendarClient });

      const result = await updateFacilityUseCase(deps, {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "元の名前",
        description: null,
        googleCalendarId: "new_cal@google.com",
        photo: null,
        removePhoto: false,
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(calendarClient.checkWriteAccess).toHaveBeenCalledWith("new_cal@google.com");
    });

    it("権限が無い（not_writable）場合、CalendarNotWritable エラーとなり、Service Account メールが含まれる", async () => {
      const calendarClient = createMockCalendarClient("not_writable");
      const deps = defaultDeps({
        calendarClient,
        calendarWriterEmail: "bot@serviceaccount.com",
      });

      const result = await updateFacilityUseCase(deps, {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "元の名前",
        description: null,
        googleCalendarId: "new_cal@google.com",
        photo: null,
        removePhoto: false,
        now,
      });

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(FacilityErrorCode.CalendarNotWritable);
      expect(error.field).toBe(FacilityField.GoogleCalendarId);
      expect(error.userMessage).toContain("bot@serviceaccount.com");
      expect(error.message).not.toContain("new_cal@google.com"); // ID を埋め込まない
    });

    it("Service Account メールが null の場合、not_writable でも汎用的な案内になる", async () => {
      const calendarClient = createMockCalendarClient("not_writable");
      const deps = defaultDeps({
        calendarClient,
        calendarWriterEmail: null,
      });

      const result = await updateFacilityUseCase(deps, {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "元の名前",
        description: null,
        googleCalendarId: "new_cal@google.com",
        photo: null,
        removePhoto: false,
        now,
      });

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(FacilityErrorCode.CalendarNotWritable);
      expect(error.userMessage).toContain(
        "Google カレンダーの共有設定で「予定の変更」の権限を付けてから",
      );
    });

    it("カレンダーが存在しない（not_found）場合、CalendarNotWritable エラーになる", async () => {
      const calendarClient = createMockCalendarClient("not_found");
      const deps = defaultDeps({ calendarClient });

      const result = await updateFacilityUseCase(deps, {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "元の名前",
        description: null,
        googleCalendarId: "unknown_cal@google.com",
        photo: null,
        removePhoto: false,
        now,
      });

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(FacilityErrorCode.CalendarNotWritable);
      expect(error.field).toBe(FacilityField.GoogleCalendarId);
    });

    it("一時的な接続エラーの場合、CalendarUnavailable エラーになる", async () => {
      const calendarClient = createMockCalendarClient("error", {
        code: CalendarErrorCode.Unavailable,
        message: "Network error",
      });
      const deps = defaultDeps({ calendarClient });

      const result = await updateFacilityUseCase(deps, {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "元の名前",
        description: null,
        googleCalendarId: "new_cal@google.com",
        photo: null,
        removePhoto: false,
        now,
      });

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(FacilityErrorCode.CalendarUnavailable);
      expect(error.field).toBe(FacilityField.GoogleCalendarId);
    });

    it("認証エラーなどの設定不備の場合、CalendarSystemError エラーになる", async () => {
      const calendarClient = createMockCalendarClient("error", {
        code: CalendarErrorCode.AuthFailed,
        message: "Auth failed",
      });
      const deps = defaultDeps({ calendarClient });

      const result = await updateFacilityUseCase(deps, {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "元の名前",
        description: null,
        googleCalendarId: "new_cal@google.com",
        photo: null,
        removePhoto: false,
        now,
      });

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(FacilityErrorCode.CalendarSystemError);
    });

    it("書き込み権限の確認でエラーになった場合、写真の保存（put）は呼ばれない", async () => {
      const putMock = vi.fn();
      const calendarClient = createMockCalendarClient("not_writable");
      const deps = defaultDeps({
        calendarClient,
        facilityPhotoStorage: { put: putMock },
      });

      const newPhoto = new File([PNG_BYTES], "new.png", { type: "image/png" });

      const result = await updateFacilityUseCase(deps, {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "元の名前",
        description: null,
        googleCalendarId: "new_cal@google.com",
        photo: newPhoto,
        removePhoto: false,
        now,
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.CalendarNotWritable);
      expect(putMock).not.toHaveBeenCalled();
    });
  });

  describe("まとめて反映（calendarResync）の判定と引き渡し", () => {
    it("名称を変更した場合、update に calendarResync が渡る（EVT-011）", async () => {
      const updateMock = vi
        .fn()
        .mockImplementation((input: UpdateFacilityInput) =>
          okAsync({ ...existingFacility, ...input }),
        );
      const deps = defaultDeps({
        facilityRepository: { update: updateMock },
      });

      const result = await updateFacilityUseCase(deps, {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: "変更された名前",
        description: existingFacility.description,
        googleCalendarId: existingFacility.googleCalendarId,
        photo: null,
        removePhoto: false,
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(updateMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          rangeStart: expect.any(Date),
        }),
      );
    });

    it("Google Calendar ID を変更した場合、update に calendarResync が渡る（EVT-009）", async () => {
      const updateMock = vi
        .fn()
        .mockImplementation((input: UpdateFacilityInput) =>
          okAsync({ ...existingFacility, ...input }),
        );
      const deps = defaultDeps({
        facilityRepository: { update: updateMock },
      });

      const result = await updateFacilityUseCase(deps, {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: existingFacility.name,
        description: existingFacility.description,
        googleCalendarId: "new_calendar@google.com",
        photo: null,
        removePhoto: false,
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(updateMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          rangeStart: expect.any(Date),
        }),
      );
    });

    it("説明のみ変更した場合、update の calendarResync は null になる", async () => {
      const updateMock = vi
        .fn()
        .mockImplementation((input: UpdateFacilityInput) =>
          okAsync({ ...existingFacility, ...input }),
        );
      const deps = defaultDeps({
        facilityRepository: { update: updateMock },
      });

      const result = await updateFacilityUseCase(deps, {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: existingFacility.name,
        description: "新しい説明文だけ",
        googleCalendarId: existingFacility.googleCalendarId,
        photo: null,
        removePhoto: false,
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(updateMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), null);
    });

    it("Google Calendar ID を解除（null化）しただけの場合、calendarResync は null になる（COND-024）", async () => {
      const updateMock = vi
        .fn()
        .mockImplementation((input: UpdateFacilityInput) =>
          okAsync({ ...existingFacility, ...input }),
        );
      const deps = defaultDeps({
        facilityRepository: { update: updateMock },
      });

      const result = await updateFacilityUseCase(deps, {
        facilityId: "fac_existing",
        actorUserId: "usr_staff_01",
        isStaff: true,
        name: existingFacility.name,
        description: existingFacility.description,
        googleCalendarId: "",
        photo: null,
        removePhoto: false,
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(updateMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), null);
    });
  });
});
