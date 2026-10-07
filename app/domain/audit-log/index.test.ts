import { describe, expect, it } from "vitest";

import {
  AuditLogAction,
  AuditLogTargetType,
  auditLogActionLabel,
  auditLogActionTargetType,
  auditLogTargetTypeLabel,
  parseAuditLogChanges,
  parseAuditLogTargetType,
  toAuditLogActorView,
  toAuditLogEntryView,
} from "./index";

describe("操作履歴のドメイン定義", () => {
  describe("auditLogActionTargetType", () => {
    it("すべての操作（AuditLogAction）を漏れなく網羅している", () => {
      const allActions = Object.values(AuditLogAction);
      const mappedActions = Object.keys(auditLogActionTargetType);

      expect(mappedActions.sort()).toEqual(allActions.sort());
    });

    it("操作の値の接頭辞と対応する対象の種類が食い違わない", () => {
      for (const [action, targetType] of Object.entries(auditLogActionTargetType)) {
        const prefix = action.split(".")[0];
        expect(prefix).toBe(targetType);
      }
    });

    it("すべての操作と対象の種類に表示名が定義されている", () => {
      for (const action of Object.values(AuditLogAction)) {
        expect(auditLogActionLabel[action]).toBeDefined();
        expect(auditLogActionLabel[action].length).toBeGreaterThan(0);
      }
      for (const targetType of Object.values(AuditLogTargetType)) {
        expect(auditLogTargetTypeLabel[targetType]).toBeDefined();
        expect(auditLogTargetTypeLabel[targetType].length).toBeGreaterThan(0);
      }
    });
  });

  describe("parseAuditLogTargetType", () => {
    it("有効な対象の種類を正しくパースする", () => {
      expect(parseAuditLogTargetType("reservation")).toBe(AuditLogTargetType.Reservation);
      expect(parseAuditLogTargetType("facility")).toBe(AuditLogTargetType.Facility);
    });

    it("無効な文字列や型の値は null を返す", () => {
      expect(parseAuditLogTargetType("unknown")).toBeNull();
      expect(parseAuditLogTargetType("")).toBeNull();
      expect(parseAuditLogTargetType(null)).toBeNull();
      expect(parseAuditLogTargetType(123)).toBeNull();
      expect(parseAuditLogTargetType(undefined)).toBeNull();
    });
  });

  describe("parseAuditLogChanges", () => {
    it("正しい変更内容オブジェクトをそのまま返す", () => {
      const validChanges = {
        status: { before: "provisional", after: "approved" },
        head_count: { before: 2, after: 4 },
        is_active: { before: true, after: false },
        note: { before: null, after: "メモ" },
      };

      expect(parseAuditLogChanges(validChanges)).toEqual(validChanges);
    });

    it("非オブジェクトや null・配列などの不正な入力に対して例外を投げず空オブジェクトを返す", () => {
      expect(parseAuditLogChanges(null)).toEqual({});
      expect(parseAuditLogChanges(undefined)).toEqual({});
      expect(parseAuditLogChanges("string")).toEqual({});
      expect(parseAuditLogChanges(123)).toEqual({});
      expect(parseAuditLogChanges([])).toEqual({});
      expect(parseAuditLogChanges([{ before: null, after: "a" }])).toEqual({});
    });

    it("before または after が欠けている項目や、値がオブジェクト等の不正な項目を除外する", () => {
      const mixed = {
        valid: { before: "a", after: "b" },
        missingAfter: { before: "a" },
        missingBefore: { after: "b" },
        nestedObjectValue: { before: { invalid: true }, after: "b" },
        arrayValue: { before: ["invalid"], after: null },
        notAnObject: "just a string",
        nullItem: null,
      };

      expect(parseAuditLogChanges(mixed)).toEqual({
        valid: { before: "a", after: "b" },
      });
    });
  });

  describe("toAuditLogActorView", () => {
    it("事務局権限の操作（actedAsStaff: true）を事務局でない人（viewer.isStaff: false）が見る場合、kind: 'staff' になる", () => {
      const view = toAuditLogActorView(
        { actorName: "事務局 太郎", actedAsStaff: true },
        { isStaff: false },
      );
      expect(view).toEqual({ kind: "staff" });
    });

    it("事務局権限の操作（actedAsStaff: true）で名前が null の場合でも、事務局でない人が見ると kind: 'staff' になる", () => {
      const view = toAuditLogActorView({ actorName: null, actedAsStaff: true }, { isStaff: false });
      expect(view).toEqual({ kind: "staff" });
    });

    it("事務局権限の操作（actedAsStaff: true）を事務局（viewer.isStaff: true）が見る場合、個人名と actedAsStaff: true が返る", () => {
      const view = toAuditLogActorView(
        { actorName: "事務局 太郎", actedAsStaff: true },
        { isStaff: true },
      );
      expect(view).toEqual({
        kind: "person",
        name: "事務局 太郎",
        actedAsStaff: true,
      });
    });

    it("事務局権限の操作（actedAsStaff: true）で名前が null の場合、事務局が見ると name: null と actedAsStaff: true が返る", () => {
      const view = toAuditLogActorView({ actorName: null, actedAsStaff: true }, { isStaff: true });
      expect(view).toEqual({
        kind: "person",
        name: null,
        actedAsStaff: true,
      });
    });

    it("一般操作（actedAsStaff: false）を一般の人が見る場合、個人名と actedAsStaff: false が返る", () => {
      const view = toAuditLogActorView(
        { actorName: "山田太郎", actedAsStaff: false },
        { isStaff: false },
      );
      expect(view).toEqual({
        kind: "person",
        name: "山田太郎",
        actedAsStaff: false,
      });
    });

    it("一般操作（actedAsStaff: false）で名前が null の場合、一般の人が見ると name: null と actedAsStaff: false が返る", () => {
      const view = toAuditLogActorView(
        { actorName: null, actedAsStaff: false },
        { isStaff: false },
      );
      expect(view).toEqual({
        kind: "person",
        name: null,
        actedAsStaff: false,
      });
    });

    it("一般操作（actedAsStaff: false）を事務局が見る場合、個人名と actedAsStaff: false が返る", () => {
      const view = toAuditLogActorView(
        { actorName: "山田太郎", actedAsStaff: false },
        { isStaff: true },
      );
      expect(view).toEqual({
        kind: "person",
        name: "山田太郎",
        actedAsStaff: false,
      });
    });
  });

  describe("toAuditLogEntryView", () => {
    const dummyDate = new Date("2026-10-01T12:00:00Z");
    const dummyChanges = {
      status: { before: "provisional", after: "approved" },
    };

    it("事務局でない人（viewer.isStaff: false）が見る場合、事務局権限の操作（actedAsStaff: true）の actor が { kind: 'staff' } になり名前を持たず、その他の項目はそのまま写る", () => {
      const entry = toAuditLogEntryView(
        {
          id: "log_1",
          occurredAt: dummyDate,
          actorName: "事務局員A",
          actedAsStaff: true,
          action: AuditLogAction.ReservationApprove,
          targetType: AuditLogTargetType.Reservation,
          targetId: "rsv_1",
          changes: dummyChanges,
        },
        { isStaff: false },
      );

      expect(entry).toEqual({
        id: "log_1",
        occurredAt: dummyDate,
        actor: { kind: "staff" },
        action: AuditLogAction.ReservationApprove,
        targetType: AuditLogTargetType.Reservation,
        targetId: "rsv_1",
        changes: dummyChanges,
      });
    });

    it("事務局（viewer.isStaff: true）が見る場合、事務局権限の操作（actedAsStaff: true）でも actor に名前が出て、その他の項目はそのまま写る", () => {
      const entry = toAuditLogEntryView(
        {
          id: "log_2",
          occurredAt: dummyDate,
          actorName: "事務局員A",
          actedAsStaff: true,
          action: AuditLogAction.ReservationApprove,
          targetType: AuditLogTargetType.Reservation,
          targetId: "rsv_1",
          changes: dummyChanges,
        },
        { isStaff: true },
      );

      expect(entry).toEqual({
        id: "log_2",
        occurredAt: dummyDate,
        actor: {
          kind: "person",
          name: "事務局員A",
          actedAsStaff: true,
        },
        action: AuditLogAction.ReservationApprove,
        targetType: AuditLogTargetType.Reservation,
        targetId: "rsv_1",
        changes: dummyChanges,
      });
    });

    it("一般操作（actedAsStaff: false）の場合、一般の人が見ても actor に名前が出て、その他の項目はそのまま写る", () => {
      const entry = toAuditLogEntryView(
        {
          id: "log_3",
          occurredAt: dummyDate,
          actorName: "一般ユーザーB",
          actedAsStaff: false,
          action: AuditLogAction.ReservationApply,
          targetType: AuditLogTargetType.Reservation,
          targetId: "rsv_1",
          changes: dummyChanges,
        },
        { isStaff: false },
      );

      expect(entry).toEqual({
        id: "log_3",
        occurredAt: dummyDate,
        actor: {
          kind: "person",
          name: "一般ユーザーB",
          actedAsStaff: false,
        },
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "rsv_1",
        changes: dummyChanges,
      });
    });
  });
});
