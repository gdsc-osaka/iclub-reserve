import { describe, expect, it } from "vitest";

import { AuditLogAction } from "../audit-log";
import {
  groupEditAuditLogAction,
  toReservationContentEditChanges,
  toReservationCreatedChanges,
  toReservationStatusChanges,
  transitionAuditLogAction,
} from "./audit-log";
import { ReservationEditOutcome } from "./edit";
import { ReservationStatus } from "./index";
import { ReservationTransition } from "./transition";

describe("reservation/audit-log", () => {
  describe("transitionAuditLogAction", () => {
    it("すべての ReservationTransition を網羅している", () => {
      const transitions = Object.values(ReservationTransition);
      for (const t of transitions) {
        expect(transitionAuditLogAction[t]).toBeDefined();
      }
      expect(transitionAuditLogAction[ReservationTransition.Withdraw]).toBe(
        AuditLogAction.ReservationWithdraw,
      );
      expect(transitionAuditLogAction[ReservationTransition.Cancel]).toBe(
        AuditLogAction.ReservationCancel,
      );
      expect(transitionAuditLogAction[ReservationTransition.Approve]).toBe(
        AuditLogAction.ReservationApprove,
      );
      expect(transitionAuditLogAction[ReservationTransition.Reject]).toBe(
        AuditLogAction.ReservationReject,
      );
      expect(transitionAuditLogAction[ReservationTransition.StaffCancel]).toBe(
        AuditLogAction.ReservationStaffCancel,
      );
    });
  });

  describe("groupEditAuditLogAction", () => {
    it("編集結果に応じた AuditLogAction を返す", () => {
      expect(groupEditAuditLogAction[ReservationEditOutcome.KeepProvisional]).toBe(
        AuditLogAction.ReservationEditProvisional,
      );
      expect(groupEditAuditLogAction[ReservationEditOutcome.KeepApproved]).toBe(
        AuditLogAction.ReservationChange,
      );
      expect(groupEditAuditLogAction[ReservationEditOutcome.Reapproval]).toBe(
        AuditLogAction.ReservationChange,
      );
    });
  });

  describe("toReservationCreatedChanges", () => {
    it("作成時の全項目を before: null で作成する", () => {
      const startAt = new Date("2026-10-10T10:00:00.000Z");
      const endAt = new Date("2026-10-10T12:00:00.000Z");
      const changes = toReservationCreatedChanges({
        facilityId: "fac_1",
        startAt,
        endAt,
        headCount: 3,
        note: "メモ",
        status: ReservationStatus.Provisional,
      });

      expect(changes).toEqual({
        facility_id: { before: null, after: "fac_1" },
        start_at: { before: null, after: "2026-10-10T10:00:00.000Z" },
        end_at: { before: null, after: "2026-10-10T12:00:00.000Z" },
        head_count: { before: null, after: 3 },
        note: { before: null, after: "メモ" },
        status: { before: null, after: "provisional" },
      });
    });
  });

  describe("toReservationStatusChanges", () => {
    it("status と status_reason の両方を必ず含める", () => {
      const changes = toReservationStatusChanges(
        { status: ReservationStatus.Provisional, statusReason: null },
        { status: ReservationStatus.Approved, statusReason: null },
      );

      expect(changes).toEqual({
        status: { before: "provisional", after: "approved" },
        status_reason: { before: null, after: null },
      });
    });

    it("理由がある場合も反映される", () => {
      const changes = toReservationStatusChanges(
        { status: ReservationStatus.Provisional, statusReason: null },
        { status: ReservationStatus.Rejected, statusReason: "定員超過のため" },
      );

      expect(changes).toEqual({
        status: { before: "provisional", after: "rejected" },
        status_reason: { before: null, after: "定員超過のため" },
      });
    });
  });

  describe("toReservationContentEditChanges", () => {
    it("変更のあった項目だけが差分に含まれる", () => {
      const startAt1 = new Date("2026-10-10T10:00:00.000Z");
      const endAt1 = new Date("2026-10-10T12:00:00.000Z");
      const before = {
        facilityId: "fac_1",
        startAt: startAt1,
        endAt: endAt1,
        headCount: 2,
        note: "メモ1",
        status: ReservationStatus.Approved,
      };
      const after = {
        facilityId: "fac_1",
        startAt: startAt1,
        endAt: endAt1,
        headCount: 4,
        note: "メモ1",
        status: ReservationStatus.Approved,
      };

      const changes = toReservationContentEditChanges(before, after);
      expect(changes).toEqual({
        head_count: { before: 2, after: 4 },
      });
    });

    it("Reapproval の場合は status（approved -> provisional）も含まれる", () => {
      const startAt1 = new Date("2026-10-10T10:00:00.000Z");
      const startAt2 = new Date("2026-10-10T11:00:00.000Z");
      const endAt1 = new Date("2026-10-10T12:00:00.000Z");
      const before = {
        facilityId: "fac_1",
        startAt: startAt1,
        endAt: endAt1,
        headCount: 2,
        note: "メモ1",
        status: ReservationStatus.Approved,
      };
      const after = {
        facilityId: "fac_1",
        startAt: startAt2,
        endAt: endAt1,
        headCount: 2,
        note: "メモ1",
        status: ReservationStatus.Provisional,
      };

      const changes = toReservationContentEditChanges(before, after);
      expect(changes).toEqual({
        start_at: {
          before: "2026-10-10T10:00:00.000Z",
          after: "2026-10-10T11:00:00.000Z",
        },
        status: {
          before: "approved",
          after: "provisional",
        },
      });
    });
  });
});
