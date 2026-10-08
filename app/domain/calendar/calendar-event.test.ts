import { describe, expect, it } from "vitest";
import { ReservationStatus } from "~/domain/reservation";
import {
  calendarSyncRangeStart,
  toCalendarEventId,
  toCalendarSyncDraft,
  toDesiredCalendarEvent,
} from "./calendar-event";

describe("calendar-event domain functions", () => {
  describe("toCalendarEventId", () => {
    it("base32hex の文字（0-9, a-v）だけで構成される", () => {
      const reservationId = "clx1234567890abcdef";
      const eventId = toCalendarEventId(reservationId);
      expect(eventId).toMatch(/^[0-9a-v]+$/);
    });

    it("長さが 5 文字以上である", () => {
      expect(toCalendarEventId("").length).toBeGreaterThanOrEqual(5);
      expect(toCalendarEventId("a").length).toBeGreaterThanOrEqual(5);
    });

    it("同じ入力に対して常に同じ値を返す（決定論的）", () => {
      const id = "res_cuid2_sample_123";
      expect(toCalendarEventId(id)).toBe(toCalendarEventId(id));
    });

    it("w〜z やアンダースコアを含む ID も安全に base32hex に変換できる", () => {
      const specialId = "reservation_with_w_x_y_z_123";
      const eventId = toCalendarEventId(specialId);
      // w, x, y, z や _ は base32hex (0-9, a-v) に含まれないが、hex 変換により 0-9, a-f に収まる
      expect(eventId).toMatch(/^[0-9a-v]+$/);
      expect(eventId.includes("w")).toBe(false);
      expect(eventId.includes("x")).toBe(false);
      expect(eventId.includes("y")).toBe(false);
      expect(eventId.includes("z")).toBe(false);
      expect(eventId.includes("_")).toBe(false);
    });

    it("違う予約 ID からは違う予定 ID になる", () => {
      expect(toCalendarEventId("res_1")).not.toBe(toCalendarEventId("res_2"));
      // 16 進表記の連結なので、日本語を含む ID でも衝突しない
      expect(toCalendarEventId("予約A")).not.toBe(toCalendarEventId("予約B"));
    });
  });

  describe("toDesiredCalendarEvent", () => {
    const validReservation = {
      id: "res_123",
      status: ReservationStatus.Approved,
      startAt: new Date("2026-10-10T10:00:00Z"),
      endAt: new Date("2026-10-10T12:00:00Z"),
    };
    const validFacility = {
      name: "第1会議室",
      googleCalendarId: "c_abc123@group.calendar.google.com",
    };

    it("承認済みかつ施設に Google Calendar ID がある場合のみ予定を返す", () => {
      const result = toDesiredCalendarEvent({
        reservation: validReservation,
        facility: validFacility,
      });

      expect(result).not.toBeNull();
      expect(result).toEqual({
        calendarId: "c_abc123@group.calendar.google.com",
        eventId: toCalendarEventId("res_123"),
        summary: "第1会議室",
        startAt: validReservation.startAt,
        endAt: validReservation.endAt,
        reservationId: "res_123",
      });
    });

    it("仮予約（provisional）の場合は null を返す", () => {
      const result = toDesiredCalendarEvent({
        reservation: { ...validReservation, status: ReservationStatus.Provisional },
        facility: validFacility,
      });
      expect(result).toBeNull();
    });

    it("終了した状態（withdrawn, rejected, cancelled, cancelled_by_staff）の場合は null を返す", () => {
      const endStatuses = [
        ReservationStatus.Withdrawn,
        ReservationStatus.Rejected,
        ReservationStatus.Cancelled,
        ReservationStatus.CancelledByStaff,
      ];
      for (const status of endStatuses) {
        const result = toDesiredCalendarEvent({
          reservation: { ...validReservation, status },
          facility: validFacility,
        });
        expect(result).toBeNull();
      }
    });

    it("施設に Google Calendar ID が無い（null または空文字）場合は null を返す", () => {
      expect(
        toDesiredCalendarEvent({
          reservation: validReservation,
          facility: { name: "第1会議室", googleCalendarId: null },
        }),
      ).toBeNull();

      expect(
        toDesiredCalendarEvent({
          reservation: validReservation,
          facility: { name: "第1会議室", googleCalendarId: "" },
        }),
      ).toBeNull();

      expect(
        toDesiredCalendarEvent({
          reservation: validReservation,
          facility: { name: "第1会議室", googleCalendarId: "   " },
        }),
      ).toBeNull();
    });

    it("施設情報が null の場合は null を返す", () => {
      const result = toDesiredCalendarEvent({
        reservation: validReservation,
        facility: null,
      });
      expect(result).toBeNull();
    });

    it("タイトルが施設名になる", () => {
      const result = toDesiredCalendarEvent({
        reservation: validReservation,
        facility: { ...validFacility, name: "特別ホール" },
      });
      expect(result?.summary).toBe("特別ホール");
    });
  });

  describe("toCalendarSyncDraft", () => {
    const reservationId = "res_456";
    const startAt = new Date("2026-10-15T09:00:00Z");
    const endAt = new Date("2026-10-15T11:00:00Z");

    const approvedTarget = {
      status: ReservationStatus.Approved,
      facilityId: "fac_1",
      startAt,
      endAt,
    };

    const provisionalTarget = {
      status: ReservationStatus.Provisional,
      facilityId: "fac_1",
      startAt,
      endAt,
    };

    it("承認（仮予約 → 承認済み）のときは draft を返す（previousFacilityId は null）", () => {
      const draft = toCalendarSyncDraft(reservationId, provisionalTarget, approvedTarget);
      expect(draft).toEqual({
        reservationId,
        previousFacilityId: null,
      });
    });

    it("新規の承認済み作成（before が null、after が承認済み）のときは draft を返す", () => {
      const draft = toCalendarSyncDraft(reservationId, null, approvedTarget);
      expect(draft).toEqual({
        reservationId,
        previousFacilityId: null,
      });
    });

    it("新規の仮予約作成（before が null、after が仮予約）のときは null を返す", () => {
      const draft = toCalendarSyncDraft(reservationId, null, provisionalTarget);
      expect(draft).toBeNull();
    });

    it("承認済みの団体キャンセル（承認済み → cancelled）のときは draft を返す", () => {
      const cancelledTarget = { ...approvedTarget, status: ReservationStatus.Cancelled };
      const draft = toCalendarSyncDraft(reservationId, approvedTarget, cancelledTarget);
      expect(draft).toEqual({
        reservationId,
        previousFacilityId: null,
      });
    });

    it("承認済みの事務局キャンセル（承認済み → cancelled_by_staff）のときは draft を返す", () => {
      const cancelledTarget = { ...approvedTarget, status: ReservationStatus.CancelledByStaff };
      const draft = toCalendarSyncDraft(reservationId, approvedTarget, cancelledTarget);
      expect(draft).toEqual({
        reservationId,
        previousFacilityId: null,
      });
    });

    it("承認済みの施設変更（承認済み → 承認済み、facilityId 変更）のときは previousFacilityId が入る", () => {
      const newFacilityTarget = { ...approvedTarget, facilityId: "fac_2" };
      const draft = toCalendarSyncDraft(reservationId, approvedTarget, newFacilityTarget);
      expect(draft).toEqual({
        reservationId,
        previousFacilityId: "fac_1",
      });
    });

    it("承認済みの予約が施設変更で仮予約に差し戻された場合も previousFacilityId が入る", () => {
      const changedToProvisional = {
        ...approvedTarget,
        status: ReservationStatus.Provisional,
        facilityId: "fac_2",
      };
      const draft = toCalendarSyncDraft(reservationId, approvedTarget, changedToProvisional);
      expect(draft).toEqual({
        reservationId,
        previousFacilityId: "fac_1",
      });
    });

    it("承認済みの日時だけの変更のときは draft を返す（previousFacilityId は null）", () => {
      const newTimeTarget = {
        ...approvedTarget,
        startAt: new Date("2026-10-15T13:00:00Z"),
        endAt: new Date("2026-10-15T15:00:00Z"),
      };
      const draft = toCalendarSyncDraft(reservationId, approvedTarget, newTimeTarget);
      expect(draft).toEqual({
        reservationId,
        previousFacilityId: null,
      });
    });

    it("承認済みのまま施設・開始・終了日時が変わらない（人数や備考のみ変更）のときは null を返す", () => {
      const draft = toCalendarSyncDraft(reservationId, approvedTarget, { ...approvedTarget });
      expect(draft).toBeNull();
    });

    it("仮予約どうしの変更（provisional → provisional）のときは null を返す", () => {
      const newProvisional = {
        ...provisionalTarget,
        startAt: new Date("2026-10-16T10:00:00Z"),
        endAt: new Date("2026-10-16T12:00:00Z"),
      };
      const draft = toCalendarSyncDraft(reservationId, provisionalTarget, newProvisional);
      expect(draft).toBeNull();
    });

    it("仮予約の取り消し・却下（provisional → withdrawn / rejected）のときは null を返す", () => {
      expect(
        toCalendarSyncDraft(reservationId, provisionalTarget, {
          ...provisionalTarget,
          status: ReservationStatus.Withdrawn,
        }),
      ).toBeNull();

      expect(
        toCalendarSyncDraft(reservationId, provisionalTarget, {
          ...provisionalTarget,
          status: ReservationStatus.Rejected,
        }),
      ).toBeNull();
    });
  });

  describe("calendarSyncRangeStart", () => {
    it("日本時間の前日 0 時ちょうどを返す", () => {
      // 2026-10-08 12:00:00 JST (2026-10-08T03:00:00Z) -> 前日は 2026-10-07 00:00:00 JST (2026-10-06T15:00:00Z)
      const now = new Date("2026-10-08T03:00:00Z");
      const rangeStart = calendarSyncRangeStart(now);
      expect(rangeStart.toISOString()).toBe("2026-10-06T15:00:00.000Z");
    });

    it("日本時間 0 時をまたぐ直前（23:59:59 JST）の場合", () => {
      // 2026-10-08 23:59:59 JST (2026-10-08T14:59:59Z) -> 当日は 10/8、前日は 10/7 00:00 JST (2026-10-06T15:00:00Z)
      const justBeforeMidnight = new Date("2026-10-08T14:59:59.999Z");
      const rangeStart = calendarSyncRangeStart(justBeforeMidnight);
      expect(rangeStart.toISOString()).toBe("2026-10-06T15:00:00.000Z");
    });

    it("日本時間 0 時をまたいだ直後（00:00:01 JST）の場合", () => {
      // 2026-10-09 00:00:01 JST (2026-10-08T15:00:01Z) -> 当日は 10/9、前日は 10/8 00:00 JST (2026-10-07T15:00:00Z)
      const justAfterMidnight = new Date("2026-10-08T15:00:01.000Z");
      const rangeStart = calendarSyncRangeStart(justAfterMidnight);
      expect(rangeStart.toISOString()).toBe("2026-10-07T15:00:00.000Z");
    });
  });
});
