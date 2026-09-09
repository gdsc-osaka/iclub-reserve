import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";

import { MembershipRole } from "~/domain/membership";
import {
  assertAllowedOrganizationRequest,
  INVALID_MEMBERSHIP_ROLE_CODE,
  parseRequestedRoles,
  ROLE_INPUT_ORGANIZATION_PATHS,
} from "./organization-guard";

/** 投げられた APIError の状態とコードを取り出す。通ってしまった場合は null */
const rejectionOf = (path: string, body?: unknown): { status: string; code: string } | null => {
  try {
    assertAllowedOrganizationRequest({ path, body });

    return null;
  } catch (error) {
    if (!(error instanceof APIError)) throw error;

    return { status: String(error.status), code: String(error.body?.code) };
  }
};

describe("parseRequestedRoles", () => {
  it.each([
    [undefined, []],
    [{}, []],
    [{ role: "admin" }, ["admin"]],
    [{ role: ["admin", "member"] }, ["admin", "member"]],
    // Better Auth はカンマ区切りの 1 文字列も複数の役割として解釈する
    [{ role: "admin,member" }, ["admin", "member"]],
    [{ role: ["admin,member", "member"] }, ["admin", "member", "member"]],
    [{ role: " admin , member " }, ["admin", "member"]],
    [{ role: "" }, []],
    [{ role: "," }, []],
    // 文字列以外は Better Auth 側の zod が弾くので、ここでは無視してよい
    [{ role: 42 }, []],
    [{ role: null }, []],
  ])("%o から %o を取り出す", (body, expected) => {
    expect(parseRequestedRoles(body)).toEqual(expected);
  });
});

describe("役割の検証", () => {
  const paths = [...ROLE_INPUT_ORGANIZATION_PATHS];

  it.each(paths.flatMap((path) => Object.values(MembershipRole).map((r) => [path, r] as const)))(
    "%s に %o を指定するのは通す",
    (path, role) => {
      expect(rejectionOf(path, { role })).toBeNull();
    },
  );

  it.each(
    paths.flatMap((path) =>
      [
        // Better Auth の既定の役割。roles に渡していなくても API からは指定できてしまう。
        // これが入ると Better Auth 側では全権限なし、こちら側では Member 扱いになり食い違う
        "owner",
        "superuser",
        "Admin",
        // 片方だけ正しい組み合わせも通してはいけない
        "admin,owner",
        "owner,member",
      ].map((role) => [path, role] as const),
    ),
  )("%s に %o を指定するのは 400 で拒否する", (path, role) => {
    expect(rejectionOf(path, { role })).toEqual({
      status: "BAD_REQUEST",
      code: INVALID_MEMBERSHIP_ROLE_CODE,
    });
  });

  it.each(paths)("%s に配列で不正な役割を混ぜても拒否する", (path) => {
    expect(rejectionOf(path, { role: [MembershipRole.Member, "owner"] })?.code).toBe(
      INVALID_MEMBERSHIP_ROLE_CODE,
    );
  });

  it.each(paths)("%s で役割を省略した場合は Better Auth の既定に任せる", (path) => {
    expect(rejectionOf(path, {})).toBeNull();
  });

  it("役割を見ない経路では role の中身を検証しない", () => {
    // ここまで検証を広げると、将来 role を持つ別の API が増えたときに
    // 想定外の場所で 400 になる
    expect(rejectionOf("/organization/list-members", { role: "owner" })).toBeNull();
  });
});
