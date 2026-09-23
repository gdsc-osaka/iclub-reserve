import { err, ok, ResultAsync } from "neverthrow";
import { facilityTable } from "~/db/schema";
import {
  FacilityErrorCode,
  type FacilityError,
  type FacilityRepository,
  type Facility,
} from "~/domain/facility";
import type { Database } from "../db";
import { eq } from "drizzle-orm";

export const createFacilityRepository = (db: Database): FacilityRepository => {
  const findById = (id: string): ResultAsync<Facility, FacilityError> =>
    ResultAsync.fromPromise(
      db.select().from(facilityTable).where(eq(facilityTable.id, id)).limit(1),
      (error): FacilityError => {
        return {
          code: FacilityErrorCode.DatabaseError,
          message: "施設テーブルを読み取れなかった。",
          cause: error,
        };
      },
    ).andThen((rows) => {
      const row = rows.at(0);

      if (row === undefined) {
        return err({
          code: FacilityErrorCode.NotFound,
          message: `施設 ${id} が見つからない。`,
        });
      }

      return ok({
        id: row.id,
        name: row.name,
        isActive: row.isActive,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        description: row.description,
      });
    });

  return { findById };
};
