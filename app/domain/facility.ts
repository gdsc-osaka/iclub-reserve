import type { ResultAsync } from "neverthrow";
import type { BaseError } from "./error";

export interface Facility {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  description: string | null;
}
export const FacilityErrorCode = {
  FacilityNotFound: "FACILITY_NOT_FOUND",
  DataBaseError: "DATABASE_ERROR",
} as const;
export type FacilityErrorCode = (typeof FacilityErrorCode)[keyof typeof FacilityErrorCode];

export interface FacilityError extends BaseError {
  readonly code: FacilityErrorCode;
}

export interface FacilityRepository {
  findById(id: string): ResultAsync<Facility, FacilityError>;
}
