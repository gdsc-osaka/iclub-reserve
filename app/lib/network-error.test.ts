import { describe, expect, it } from "vite-plus/test";

import { isNetworkError } from "./network-error";

describe("isNetworkError", () => {
  it.each([
    ["Chrome・Edge", "Failed to fetch"],
    ["Firefox", "NetworkError when attempting to fetch resource"],
    ["Safari", "Load failed"],
    ["古い Safari", "The network connection was lost"],
  ])("通信エラーの TypeError は true を返す: %s (%s)", (_, message) => {
    expect(isNetworkError(new TypeError(message))).toBe(true);
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
