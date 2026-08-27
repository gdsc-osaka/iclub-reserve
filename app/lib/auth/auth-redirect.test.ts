import { describe, expect, it } from "vitest";
import {
  isPublicPath,
  LOGIN_PATH,
  readRedirectTo,
  toCurrentPath,
  toCurrentPathname,
  toSafeRedirectTo,
  withRedirectTo,
} from "./auth-redirect";

describe("toSafeRedirectTo", () => {
  it.each([
    ["サイト内のパス", "/reservation", "/reservation"],
    ["クエリ付きのパス", "/reservation?date=2026-08-23", "/reservation?date=2026-08-23"],
  ])("%s はそのまま通す", (_, value, expected) => {
    expect(toSafeRedirectTo(value)).toBe(expected);
  });

  it.each([
    ["外部サイト", "https://example.com"],
    ["スキーム省略の外部サイト", "//example.com"],
    ["相対パス", "reservation"],
    ["指定なし", null],
    ["空文字", ""],
  ])("%s はトップページに送る", (_, value) => {
    expect(toSafeRedirectTo(value)).toBe("/");
  });
});

describe("readRedirectTo", () => {
  it("クエリパラメータから遷移先を取り出す", () => {
    const request = new Request("https://example.com/login?redirectTo=%2Freservation");

    expect(readRedirectTo(request)).toBe("/reservation");
  });

  it("外部サイトが指定されていてもトップページに送る", () => {
    const request = new Request("https://example.com/login?redirectTo=https%3A%2F%2Fevil.example");

    expect(readRedirectTo(request)).toBe("/");
  });
});

describe("isPublicPath", () => {
  it.each([
    ["ログイン画面", "/login"],
    ["お名前の登録画面", "/welcome"],
    ["Better Auth の API", "/api/auth/email-otp/send-verification-otp"],
  ])("%s はログインなしで開ける", (_, pathname) => {
    expect(isPublicPath(pathname)).toBe(true);
  });

  it.each([
    ["トップページ", "/"],
    ["予約画面", "/reservation"],
    ["存在しない画面", "/unknown"],
    ["ログイン画面に似ているだけのパス", "/login-guide"],
    ["ログイン画面の下の階層", "/login/extra"],
    ["Better Auth 以外の API", "/api/reservations"],
  ])("%s はログインが必要", (_, pathname) => {
    expect(isPublicPath(pathname)).toBe(false);
  });
});

describe("toCurrentPathname", () => {
  it("クエリパラメータを取り除いたパスを返す", () => {
    const request = new Request("https://example.com/reservation?date=2026-08-23");

    expect(toCurrentPathname(request)).toBe("/reservation");
  });

  it("画面遷移用のリクエスト（.data）も元のパスに戻す", () => {
    const request = new Request(
      "https://example.com/reservation.data?_routes=routes%2Freservation",
    );

    expect(toCurrentPathname(request)).toBe("/reservation");
  });

  it("トップページの画面遷移用リクエスト（/_.data）も元に戻す", () => {
    const request = new Request("https://example.com/_.data");

    expect(toCurrentPathname(request)).toBe("/");
  });
});

describe("toCurrentPath", () => {
  it("通常のリクエストはパスとクエリをそのまま返す", () => {
    const request = new Request("https://example.com/reservation?date=2026-08-23");

    expect(toCurrentPath(request)).toBe("/reservation?date=2026-08-23");
  });

  it("画面遷移用のリクエスト（.data と _routes）を取り除く", () => {
    const request = new Request(
      "https://example.com/reservation.data?_routes=routes%2Freservation&date=2026-08-23",
    );

    expect(toCurrentPath(request)).toBe("/reservation?date=2026-08-23");
  });

  it("トップページの画面遷移用リクエスト（/_.data）も元に戻す", () => {
    const request = new Request("https://example.com/_.data");

    expect(toCurrentPath(request)).toBe("/");
  });
});

describe("withRedirectTo", () => {
  it("戻り先をクエリパラメータとして付ける", () => {
    expect(withRedirectTo(LOGIN_PATH, "/reservation")).toBe("/login?redirectTo=%2Freservation");
  });

  it("戻り先がトップページならパラメータを付けない", () => {
    expect(withRedirectTo(LOGIN_PATH, "/")).toBe("/login");
  });

  it("外部サイトが渡されてもパラメータを付けない", () => {
    expect(withRedirectTo(LOGIN_PATH, "https://evil.example")).toBe("/login");
  });
});
