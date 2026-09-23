import { describe, expect, it } from "vitest";
import { ReservationStatus } from "../reservation";
import { isBlockingReservation } from "./deactivation";

describe("isBlockingReservation（COND-003: 施設無効化を阻害する予約の判定）", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");

  describe("仮予約（Provisional）", () => {
    it("開始前で終了が未来（start_at > now, end_at > now）なら無効化を止める", () => {
      const reservation = {
        status: ReservationStatus.Provisional,
        startAt: new Date("2026-10-01T13:00:00.000Z"),
        endAt: new Date("2026-10-01T14:00:00.000Z"),
      };
      expect(isBlockingReservation(reservation, now)).toBe(true);
    });

    it("開始時刻を過ぎているが終了が未来（start_at < now, end_at > now）でも無効化を止める", () => {
      const reservation = {
        status: ReservationStatus.Provisional,
        startAt: new Date("2026-10-01T11:00:00.000Z"),
        endAt: new Date("2026-10-01T13:00:00.000Z"),
      };
      expect(isBlockingReservation(reservation, now)).toBe(true);
    });

    it("終了時刻がちょうど現在（end_at == now）なら無効化を止めない", () => {
      const reservation = {
        status: ReservationStatus.Provisional,
        startAt: new Date("2026-10-01T11:00:00.000Z"),
        endAt: new Date("2026-10-01T12:00:00.000Z"),
      };
      expect(isBlockingReservation(reservation, now)).toBe(false);
    });

    it("終了時刻が過去（end_at < now）なら無効化を止めない", () => {
      const reservation = {
        status: ReservationStatus.Provisional,
        startAt: new Date("2026-10-01T10:00:00.000Z"),
        endAt: new Date("2026-10-01T11:00:00.000Z"),
      };
      expect(isBlockingReservation(reservation, now)).toBe(false);
    });
  });

  describe("承認済み（Approved）", () => {
    it("開始時刻が未来（start_at > now）なら無効化を止める", () => {
      const reservation = {
        status: ReservationStatus.Approved,
        startAt: new Date("2026-10-01T13:00:00.000Z"),
        endAt: new Date("2026-10-01T14:00:00.000Z"),
      };
      expect(isBlockingReservation(reservation, now)).toBe(true);
    });

    it("開始時刻がちょうど現在（start_at == now）なら無効化を止めない（使用中扱い）", () => {
      const reservation = {
        status: ReservationStatus.Approved,
        startAt: new Date("2026-10-01T12:00:00.000Z"),
        endAt: new Date("2026-10-01T13:00:00.000Z"),
      };
      expect(isBlockingReservation(reservation, now)).toBe(false);
    });

    it("現在使用中（start_at < now && end_at > now）なら無効化を止めない", () => {
      const reservation = {
        status: ReservationStatus.Approved,
        startAt: new Date("2026-10-01T11:00:00.000Z"),
        endAt: new Date("2026-10-01T13:00:00.000Z"),
      };
      expect(isBlockingReservation(reservation, now)).toBe(false);
    });

    it("現在終了直前（start_at < now && end_at == now）なら無効化を止めない", () => {
      const reservation = {
        status: ReservationStatus.Approved,
        startAt: new Date("2026-10-01T11:00:00.000Z"),
        endAt: new Date("2026-10-01T12:00:00.000Z"),
      };
      expect(isBlockingReservation(reservation, now)).toBe(false);
    });

    it("既に終了済み（end_at < now）なら無効化を止めない", () => {
      const reservation = {
        status: ReservationStatus.Approved,
        startAt: new Date("2026-10-01T09:00:00.000Z"),
        endAt: new Date("2026-10-01T10:00:00.000Z"),
      };
      expect(isBlockingReservation(reservation, now)).toBe(false);
    });
  });

  describe("終了状態の予約（日時によらず無効化を止めない）", () => {
    it.each([
      ReservationStatus.Withdrawn,
      ReservationStatus.Rejected,
      ReservationStatus.Cancelled,
      ReservationStatus.CancelledByStaff,
    ])("ステータスが %s の場合、未来の日時でも無効化を止めない", (status) => {
      const reservation = {
        status,
        startAt: new Date("2026-10-01T14:00:00.000Z"),
        endAt: new Date("2026-10-01T15:00:00.000Z"),
      };
      expect(isBlockingReservation(reservation, now)).toBe(false);
    });
  });
});
