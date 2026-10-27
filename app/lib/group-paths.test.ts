import { describe, expect, it } from "vite-plus/test";

import { AppArea } from "~/lib/app-area";

import { toGroupDetailPath } from "./group-paths";

describe("group-paths", () => {
  describe("toGroupDetailPath", () => {
    it.each([
      [AppArea.User, "grp_123", "/groups/grp_123"],
      [AppArea.Staff, "grp_123", "/staff/groups/grp_123"],
      [AppArea.User, "grp/123", "/groups/grp%2F123"],
      [AppArea.Staff, "grp/123", "/staff/groups/grp%2F123"],
    ])("%s で %s のときは %s を返す", (area, id, expected) => {
      expect(toGroupDetailPath(area, id)).toBe(expected);
    });
  });
});
