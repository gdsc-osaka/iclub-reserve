import { describe, expect, it } from "vitest";

import { toSamePagePath } from "./form-redirect";

/** アクションに届くリクエストを組み立てる */
const post = (url: string) => new Request(url, { method: "POST" });

describe("toSamePagePath", () => {
  it("JavaScript が動いているときのデータ URL から、画面のパスに戻す", () => {
    expect(toSamePagePath(post("http://localhost:5173/reservations.data"))).toBe("/reservations");
  });

  it("絞り込みのクエリは残す", () => {
    expect(toSamePagePath(post("http://localhost:5173/reservations.data?status=provisional"))).toBe(
      "/reservations?status=provisional",
    );
  });

  it("React Router が付ける _routes は落とす", () => {
    expect(
      toSamePagePath(
        post("http://localhost:5173/staff/reservations.data?status=all&_routes=routes%2Fx"),
      ),
    ).toBe("/staff/reservations?status=all");
  });

  it("JavaScript が動いていないときの通常の POST はそのまま戻す", () => {
    expect(toSamePagePath(post("http://localhost:5173/staff/reservations?period=past"))).toBe(
      "/staff/reservations?period=past",
    );
  });

  it("トップページのデータ URL はトップページに戻す", () => {
    expect(toSamePagePath(post("http://localhost:5173/_root.data"))).toBe("/");
  });
});
