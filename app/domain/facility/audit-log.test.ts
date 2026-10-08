import { describe, expect, it } from "vitest";

import { AuditLogAction } from "../audit-log";
import {
  facilityStatusAuditLogAction,
  toFacilityCreateChanges,
  toFacilityStatusAction,
  toFacilityStatusChanges,
  toFacilityUpdateChanges,
} from "./audit-log";

describe("facility audit-log", () => {
  describe("toFacilityCreateChanges", () => {
    it("全項目の before が null で after に値が入る", () => {
      const changes = toFacilityCreateChanges({
        name: "第1会議室",
        description: "プロジェクターあり",
        photoUrl: "https://example.com/photo.jpg",
        googleCalendarId: "cal_123",
        calendarUrl: "https://calendar.google.com/cal_123",
        isActive: true,
      });

      expect(changes).toEqual({
        name: { before: null, after: "第1会議室" },
        description: { before: null, after: "プロジェクターあり" },
        photo_url: { before: null, after: "https://example.com/photo.jpg" },
        google_calendar_id: { before: null, after: "cal_123" },
        calendar_url: { before: null, after: "https://calendar.google.com/cal_123" },
        is_active: { before: null, after: true },
      });
    });
  });

  describe("toFacilityUpdateChanges", () => {
    it("値が変わった項目だけが抽出される", () => {
      const before = {
        name: "第1会議室",
        description: "プロジェクターあり",
        photoUrl: "https://example.com/photo1.jpg",
        googleCalendarId: "cal_123",
        calendarUrl: "https://calendar.google.com/cal_123",
      };
      const after = {
        name: "第1会議室（大）",
        description: "プロジェクターあり",
        photoUrl: null,
        googleCalendarId: "cal_123",
        calendarUrl: "https://calendar.google.com/cal_123",
      };

      const changes = toFacilityUpdateChanges(before, after);

      expect(changes).toEqual({
        name: { before: "第1会議室", after: "第1会議室（大）" },
        photo_url: { before: "https://example.com/photo1.jpg", after: null },
      });
    });

    it("変更がない場合は空オブジェクトを返す", () => {
      const item = {
        name: "第1会議室",
        description: "プロジェクターあり",
        photoUrl: "https://example.com/photo1.jpg",
        googleCalendarId: "cal_123",
        calendarUrl: "https://calendar.google.com/cal_123",
      };

      const changes = toFacilityUpdateChanges(item, item);

      expect(changes).toEqual({});
    });
  });

  describe("toFacilityStatusAction", () => {
    it("有効化 (true) のときは FacilityReactivate", () => {
      expect(toFacilityStatusAction(true)).toBe(AuditLogAction.FacilityReactivate);
      expect(facilityStatusAuditLogAction.active).toBe(AuditLogAction.FacilityReactivate);
    });

    it("無効化 (false) のときは FacilityDeactivate", () => {
      expect(toFacilityStatusAction(false)).toBe(AuditLogAction.FacilityDeactivate);
      expect(facilityStatusAuditLogAction.inactive).toBe(AuditLogAction.FacilityDeactivate);
    });
  });

  describe("toFacilityStatusChanges", () => {
    it("is_active の前後の値が入る", () => {
      expect(toFacilityStatusChanges(true, false)).toEqual({
        is_active: { before: true, after: false },
      });
      expect(toFacilityStatusChanges(false, true)).toEqual({
        is_active: { before: false, after: true },
      });
    });
  });
});
