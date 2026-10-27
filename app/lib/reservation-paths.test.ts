import { describe, expect, it } from "vite-plus/test";

import { AppArea } from "~/lib/app-area";

import {
  toFormPathForFacility,
  toNewReservationPath,
  toReservationDetailPath,
  toReservationEditPath,
} from "./reservation-paths";

describe("reservation-paths", () => {
  describe("toReservationDetailPath", () => {
    it.each([
      [AppArea.User, "res_123", "/reservations/res_123"],
      [AppArea.Staff, "res_123", "/staff/reservations/res_123"],
      [AppArea.User, "res/123", "/reservations/res%2F123"],
      [AppArea.Staff, "res/123", "/staff/reservations/res%2F123"],
    ])("%s で %s のときは %s を返す", (area, id, expected) => {
      expect(toReservationDetailPath(area, id)).toBe(expected);
    });
  });

  describe("toReservationEditPath", () => {
    it.each([
      [AppArea.User, "res_123", "/reservations/res_123/edit"],
      [AppArea.Staff, "res_123", "/staff/reservations/res_123/edit"],
      [AppArea.User, "res/123", "/reservations/res%2F123/edit"],
      [AppArea.Staff, "res/123", "/staff/reservations/res%2F123/edit"],
    ])("%s で %s のときは %s を返す", (area, id, expected) => {
      expect(toReservationEditPath(area, id)).toBe(expected);
    });
  });

  describe("toNewReservationPath", () => {
    it.each([
      [AppArea.User, "/reservations/new"],
      [AppArea.Staff, "/staff/reservations/new"],
    ])("%s のときは %s を返す", (area, expected) => {
      expect(toNewReservationPath(area)).toBe(expected);
    });
  });

  describe("toFormPathForFacility", () => {
    it.each([
      [AppArea.User, "fac_1", "/reservations/new?facility=fac_1"],
      [AppArea.Staff, "fac_1", "/staff/reservations/new?facility=fac_1"],
      [AppArea.User, "fac/1", "/reservations/new?facility=fac%2F1"],
      [AppArea.Staff, "fac/1", "/staff/reservations/new?facility=fac%2F1"],
    ])("%s で %s のときは %s を返す", (area, facilityId, expected) => {
      expect(toFormPathForFacility(area, facilityId)).toBe(expected);
    });
  });
});
