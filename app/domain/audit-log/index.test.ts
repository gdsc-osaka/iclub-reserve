import { describe, expect, it } from "vitest";

import {
  AuditLogAction,
  AuditLogTargetType,
  auditLogActionLabel,
  auditLogActionTargetType,
  auditLogTargetTypeLabel,
  parseAuditLogChanges,
  parseAuditLogTargetType,
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
});
