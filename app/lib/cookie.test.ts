import { describe, expect, it } from "vite-plus/test";

import { findCookieValue } from "./cookie";

describe("findCookieValue", () => {
  it("名前が一致した cookie の値を返す", () => {
    expect(findCookieValue("theme=dark; user_id=123", "user_id")).toBe("123");
    expect(findCookieValue("user_id=123", "user_id")).toBe("123");
    expect(findCookieValue("user_id=%E3%81%82", "user_id")).toBe("あ");
  });

  it("cookie が無いときは null を返す", () => {
    expect(findCookieValue("theme=dark", "user_id")).toBeNull();
    expect(findCookieValue("user_id_extra=123", "user_id")).toBeNull();
    expect(findCookieValue("x_user_id=123", "user_id")).toBeNull();
    expect(findCookieValue("user_id", "user_id")).toBeNull();
    expect(findCookieValue("", "user_id")).toBeNull();
  });

  it("ヘッダーが null のときは null を返す", () => {
    expect(findCookieValue(null, "user_id")).toBeNull();
  });

  it("壊れた % が含まれていても例外を投げずに null を返す", () => {
    expect(() => findCookieValue("user_id=%", "user_id")).not.toThrow();
    expect(findCookieValue("user_id=%", "user_id")).toBeNull();
    expect(findCookieValue("user_id=%zz", "user_id")).toBeNull();
    expect(findCookieValue("user_id=%E3%81", "user_id")).toBeNull();
  });
});
