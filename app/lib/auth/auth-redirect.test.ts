import { describe, expect, it } from "vite-plus/test";
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
    ["ハッシュ付きのパス", "/reservation#today", "/reservation#today"],
    ["日本語のクエリ付きのパス", "/reservation?keyword=会議室", "/reservation?keyword=会議室"],
    [
      "エンコード済みの日本語のクエリ付きのパス",
      "/reservation?keyword=%E4%BC%9A%E8%AD%B0%E5%AE%A4",
      "/reservation?keyword=%E4%BC%9A%E8%AD%B0%E5%AE%A4",
    ],
  ])("%s はそのまま通す", (_, value, expected) => {
    expect(toSafeRedirectTo(value)).toBe(expected);
  });

  it.each([
    ["外部サイト", "https://example.com"],
    ["スキーム省略の外部サイト", "//example.com"],
    ["相対パス", "reservation"],
    ["指定なし", null],
    ["空文字", ""],
    ["トップページ（/）", "/"],
    ["クエリ付きのトップページ", "/?utm_source=mail"],
    ["ハッシュ付きのトップページ", "/#top"],
    // ブラウザは "\" を "/" と同じに扱い、タブと改行を取り除くので、どれも "//evil.example" として開かれる
    ["バックスラッシュで始まる外部サイト", "/\\evil.example"],
    ["タブを挟んだ外部サイト", "/\t/evil.example"],
    ["LF を挟んだ外部サイト", "/\n/evil.example"],
    ["CR を挟んだ外部サイト", "/\r/evil.example"],
    ["タブとバックスラッシュを挟んだ外部サイト", "/\t\\evil.example"],
    // React Router が "./" や "x/../" を解決すると、途中のタブが先頭に来る
    ["「./」の後ろにタブを挟んだ外部サイト", "/./\t/evil.example"],
    ["「x/../」の後ろにタブを挟んだ外部サイト", "/x/../\t/evil.example"],
    ["「./」の後ろにタブとバックスラッシュを挟んだ外部サイト", "/./\t\\evil.example"],
    ["途中にバックスラッシュを含むパス", "/reservation\\evil.example"],
  ])("%s は /start に送る", (_, value) => {
    expect(toSafeRedirectTo(value)).toBe("/start");
  });
});

describe("readRedirectTo", () => {
  it("クエリパラメータから遷移先を取り出す", () => {
    const request = new Request("https://example.com/login?redirectTo=%2Freservation");

    expect(readRedirectTo(request)).toBe("/reservation");
  });

  it("外部サイトが指定されていても /start に送る", () => {
    const request = new Request("https://example.com/login?redirectTo=https%3A%2F%2Fevil.example");

    expect(readRedirectTo(request)).toBe("/start");
  });

  it.each([
    ["バックスラッシュ", "%2F%5Cevil.example%2Flogin"],
    ["「./」の後ろのタブ", "%2F.%2F%09%2Fevil.example%2Flogin"],
  ])("%s で外部サイトへ向けられていても /start に送る", (_, encoded) => {
    const request = new Request(`https://example.com/login?redirectTo=${encoded}`);

    expect(readRedirectTo(request)).toBe("/start");
  });

  it("withRedirectTo で引き継いだ遷移先は、そのまま取り出せる", () => {
    const redirectTo = "/reservation?keyword=会議室#today";
    const request = new Request(`https://example.com${withRedirectTo(LOGIN_PATH, redirectTo)}`);

    expect(readRedirectTo(request)).toBe(redirectTo);
  });

  it.each([
    ["今いる画面そのもの", "/passkey/suggest", "%2Fpasskey%2Fsuggest"],
    ["今いる画面（クエリ付き）", "/welcome", "%2Fwelcome%3Fstep%3D2"],
  ])("遷移先に %s が指定されていたら /start に送る", (_, pathname, encoded) => {
    const request = new Request(`https://example.com${pathname}?redirectTo=${encoded}`);

    expect(readRedirectTo(request)).toBe("/start");
  });

  it("画面内の遷移で使われる .data 付きの URL でも、今いる画面だと判定できる", () => {
    const request = new Request(
      "https://example.com/passkey/suggest.data?redirectTo=%2Fpasskey%2Fsuggest",
    );

    expect(readRedirectTo(request)).toBe("/start");
  });
});

describe("isPublicPath", () => {
  it.each([
    ["ログイン画面", "/login"],
    ["お名前の登録画面", "/welcome"],
    ["Better Auth の API", "/api/auth/email-otp/send-verification-otp"],
    ["自団体の予約カレンダー配信", "/calendar-feeds/sample_token_123.ics"],
    ["開発専用ルート（メールの送信）", "/dev/flush-mail"],
    ["開発専用ルート（カレンダーの同期）", "/dev/sync-calendar"],
    ["開発専用ルート（メールの文面の見本）", "/dev/mail-preview"],
  ])("%s はログインなしで開ける", (_, pathname) => {
    expect(isPublicPath(pathname)).toBe(true);
  });

  it.each([
    ["トップページ", "/"],
    ["予約画面", "/reservation"],
    ["存在しない画面", "/unknown"],
    ["パスキーの登録を勧める画面", "/passkey/suggest"],
    ["ログイン画面に似ているだけのパス", "/login-guide"],
    ["ログイン画面の下の階層", "/login/extra"],
    ["Better Auth 以外の API", "/api/reservations"],
    // 開発専用ルートは 1 本ずつ許可する。/dev/ の下をまとめて開けてしまわないことを固定する
    ["許可していない開発専用ルート", "/dev/other"],
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

  it.each([
    ["トップページ（/）", "/"],
    ["クエリ付きのトップページ", "/?utm_source=mail"],
  ])("戻り先が %s ならパラメータを付けない", (_, redirectTo) => {
    expect(withRedirectTo(LOGIN_PATH, redirectTo)).toBe("/login");
  });

  it("戻り先が /start（既定）ならパラメータを付けない", () => {
    expect(withRedirectTo(LOGIN_PATH, "/start")).toBe("/login");
  });

  it("外部サイトが渡されてもパラメータを付けない", () => {
    expect(withRedirectTo(LOGIN_PATH, "https://evil.example")).toBe("/login");
  });
});
