import { APIError } from "better-auth/api";

import { isMembershipRole } from "~/domain/membership";

/**
 * 組織エンドポイントへのリクエストを入口で選り分ける。
 *
 * `app/routes/api.auth.$.ts` は catch-all なので、組織プラグインが生やす
 * エンドポイントはすべて外から叩ける。ここはその唯一の関門になる。
 *
 * Better Auth の設定 (app/lib/auth/auth.server.ts) から切り離してあるのは、
 * あちらが `cloudflare:workers` を読むためテストから触れないから。
 * 判定は純粋な関数として、ここで検証する。
 */

/**
 * 役割を本文で受け取る組織エンドポイント。
 *
 * ここに来た `role` は MembershipRole だけに限る。理由は
 * `isMembershipRole` (app/domain/membership/index.ts) を参照。
 */
export const ROLE_INPUT_ORGANIZATION_PATHS: ReadonlySet<string> = new Set([
  "/organization/invite-member",
  "/organization/update-member-role",
]);

/** 使えない役割を指定されたときのエラーコード */
export const INVALID_MEMBERSHIP_ROLE_CODE = "INVALID_MEMBERSHIP_ROLE";

/**
 * リクエスト本文から、指定された役割を取り出す。
 *
 * Better Auth は配列でもカンマ区切りの文字列でも複数の役割を受け取り、
 * 内部で同じように分解する (crud-members.ts の roleToSet)。
 * 分解の仕方を合わせておかないと、"admin,owner" のような値が
 * 検証をすり抜けたうえで Better Auth 側では 2 つの役割として解釈される。
 */
export const parseRequestedRoles = (body: unknown): readonly string[] => {
  const role = (body as { role?: unknown } | undefined)?.role;
  const values = role === undefined ? [] : Array.isArray(role) ? role : [role];

  return values
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value !== "");
};

/**
 * 通してよいリクエストかを判定し、駄目なら APIError を投げる。
 */
export const assertAllowedOrganizationRequest = (request: {
  readonly path: string;
  readonly body?: unknown;
}): void => {
  if (!ROLE_INPUT_ORGANIZATION_PATHS.has(request.path)) return;

  if (parseRequestedRoles(request.body).some((role) => !isMembershipRole(role))) {
    throw new APIError("BAD_REQUEST", {
      code: INVALID_MEMBERSHIP_ROLE_CODE,
      message: "指定された役割は使用できません。",
    });
  }
};
