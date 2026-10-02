import { describe, expect, it, vi } from "vitest";

import { ACCOUNT_PATH, PASSKEY_SUGGEST_PATH, WELCOME_PATH } from "~/lib/auth/auth-redirect";
import { resolveLoginNextPath } from "./use-login-form";

describe("resolveLoginNextPath", () => {
  const completedUser = { name: "阪大 太郎" };
  const incompleteUser = { name: "" };

  it("名前が未設定のユーザーは WELCOME_PATH へ送られる", async () => {
    const nextPath = await resolveLoginNextPath({
      user: incompleteUser,
      method: "email-otp",
      redirectTo: "/reservations",
    });

    expect(nextPath).toContain(WELCOME_PATH);
  });

  it("パスキーでログインしたユーザーはそのまま redirectTo へ進む", async () => {
    const nextPath = await resolveLoginNextPath({
      user: completedUser,
      method: "passkey",
      redirectTo: "/reservations",
    });

    expect(nextPath).toBe("/reservations");
  });

  it("戻り先が /account のときは、パスキーを勧める画面（PASSKEY_SUGGEST_PATH / SCR-015）を挟まない", async () => {
    const detectPasskeySupportFn = vi.fn(async () => ({ canRegisterOnThisDevice: true }));
    const shouldSuggestPasskeyFn = vi.fn(() => true);

    const nextPath = await resolveLoginNextPath({
      user: completedUser,
      method: "email-otp",
      redirectTo: ACCOUNT_PATH,
      detectPasskeySupportFn,
      shouldSuggestPasskeyFn,
    });

    expect(nextPath).toBe(ACCOUNT_PATH);
    expect(nextPath).not.toContain(PASSKEY_SUGGEST_PATH);
  });

  it("戻り先が /account?foo=bar のようにクエリ付きでも PASSKEY_SUGGEST_PATH を挟まない", async () => {
    const detectPasskeySupportFn = vi.fn(async () => ({ canRegisterOnThisDevice: true }));
    const shouldSuggestPasskeyFn = vi.fn(() => true);

    const nextPath = await resolveLoginNextPath({
      user: completedUser,
      method: "email-otp",
      redirectTo: `${ACCOUNT_PATH}?reauthenticated=1`,
      detectPasskeySupportFn,
      shouldSuggestPasskeyFn,
    });

    expect(nextPath).toBe(`${ACCOUNT_PATH}?reauthenticated=1`);
    expect(nextPath).not.toContain(PASSKEY_SUGGEST_PATH);
  });

  it("戻り先が通常の画面でパスキー登録可能な端末なら PASSKEY_SUGGEST_PATH へ送られる", async () => {
    const detectPasskeySupportFn = vi.fn(async () => ({ canRegisterOnThisDevice: true }));
    const shouldSuggestPasskeyFn = vi.fn(() => true);

    const nextPath = await resolveLoginNextPath({
      user: completedUser,
      method: "email-otp",
      redirectTo: "/reservations",
      detectPasskeySupportFn,
      shouldSuggestPasskeyFn,
    });

    expect(nextPath).toContain(PASSKEY_SUGGEST_PATH);
    expect(nextPath).toContain("redirectTo=%2Freservations");
  });
});
