import { describe, expect, it } from "vite-plus/test";

import { isNetworkError } from "./network-error";

describe("isNetworkError", () => {
  it.each([
    ["Chrome・Edge", "Failed to fetch"],
    ["Chrome・Edge（本文の途中で切れたとき）", "network error"],
    ["Firefox", "NetworkError when attempting to fetch resource"],
    ["Firefox（本文の途中で切れたとき）", "Error in input stream"],
    ["Safari", "Load failed"],
    ["古い Safari", "The network connection was lost"],
  ])("通信エラーの TypeError は true を返す: %s (%s)", (_, message) => {
    expect(isNetworkError(new TypeError(message))).toBe(true);
  });

  it("本文を読めなかったエラーに包まれた通信エラーは true を返す", () => {
    const error = new Error("Unable to decode turbo-stream response", {
      cause: new TypeError("network error"),
    });
    expect(isNetworkError(error)).toBe(true);
  });

  it("本文が壊れていただけのとき（cause が通信のエラーでない）は false を返す", () => {
    const error = new Error("Unable to decode turbo-stream response", {
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    expect(isNetworkError(error)).toBe(false);
  });

  it("本文を読めなかったエラーで cause が無いときは false を返す", () => {
    expect(isNetworkError(new Error("Unable to decode turbo-stream response"))).toBe(false);
  });

  it("ほかの文言の TypeError は false を返す", () => {
    expect(isNetworkError(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });

  it("TypeError でない Error は false を返す", () => {
    expect(isNetworkError(new Error("Failed to fetch"))).toBe(false);
  });

  it("new Response(null, { status: 500 }) は false を返す", () => {
    expect(isNetworkError(new Response(null, { status: 500 }))).toBe(false);
  });

  it("文字列は false を返す", () => {
    expect(isNetworkError("Failed to fetch")).toBe(false);
  });

  it("null は false を返す", () => {
    expect(isNetworkError(null)).toBe(false);
  });
});
