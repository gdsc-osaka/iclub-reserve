import { describe, expect, it } from "vitest";

import {
  parseReservationListParams,
  toReservationListPath,
  type ParsedReservationListParams,
} from "./query-params";

describe("parseReservationListParams", () => {
  it("/reservations の未指定時は status=all, period=upcoming, facility=null, group=null になる", () => {
    const searchParams = new URLSearchParams();
    const result = parseReservationListParams(searchParams, "own");

    expect(result).toEqual<ParsedReservationListParams>({
      group: null,
      status: "all",
      period: "upcoming",
      facility: null,
    });
  });

  it("/staff/reservations の未指定時は status=provisional, period=upcoming, facility=null, group=null になる", () => {
    const searchParams = new URLSearchParams();
    const result = parseReservationListParams(searchParams, "all");

    expect(result).toEqual<ParsedReservationListParams>({
      group: null,
      status: "provisional",
      period: "upcoming",
      facility: null,
    });
  });

  it("正しいパラメータが渡された場合はそのままパースされる", () => {
    const searchParams = new URLSearchParams({
      group: "grp_robotics",
      status: "approved",
      period: "past",
      facility: "fac_meeting_a",
    });

    const result = parseReservationListParams(searchParams, "own");

    expect(result).toEqual<ParsedReservationListParams>({
      group: "grp_robotics",
      status: "approved",
      period: "past",
      facility: "fac_meeting_a",
    });
  });

  it("scope=all では group パラメータが渡されても null になる", () => {
    const searchParams = new URLSearchParams({
      group: "grp_robotics",
    });

    const result = parseReservationListParams(searchParams, "all");
    expect(result.group).toBeNull();
  });

  it("壊れた status や period は既定値に安全にフォールバックする", () => {
    const searchParams = new URLSearchParams({
      status: "invalid_status",
      period: "unknown_period",
      facility: "   ",
    });

    const ownResult = parseReservationListParams(searchParams, "own");
    expect(ownResult.status).toBe("all");
    expect(ownResult.period).toBe("upcoming");
    expect(ownResult.facility).toBeNull();

    const staffResult = parseReservationListParams(searchParams, "all");
    expect(staffResult.status).toBe("provisional");
    expect(staffResult.period).toBe("upcoming");
    expect(staffResult.facility).toBeNull();
  });
});

describe("toReservationListPath", () => {
  it("own スコープで既定値のみの場合は /reservations を返す", () => {
    expect(toReservationListPath({ status: "all", period: "upcoming" }, "own")).toBe(
      "/reservations",
    );
  });

  it("all スコープで既定値のみの場合は /staff/reservations を返す", () => {
    expect(toReservationListPath({ status: "provisional", period: "upcoming" }, "all")).toBe(
      "/staff/reservations",
    );
  });

  it("パラメータが指定されている場合はクエリ文字列を構築する", () => {
    expect(
      toReservationListPath(
        {
          group: "grp_robotics",
          status: "approved",
          period: "past",
          facility: "fac_meeting_a",
        },
        "own",
      ),
    ).toBe("/reservations?group=grp_robotics&status=approved&period=past&facility=fac_meeting_a");
  });

  it("all スコープでは group を付与しない", () => {
    expect(
      toReservationListPath(
        {
          group: "grp_robotics",
          status: "approved",
        },
        "all",
      ),
    ).toBe("/staff/reservations?status=approved");
  });
});
