import type { ResultAsync } from "neverthrow";

export interface Group {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const GroupErrorCode = {
  GroupNotFound: "GROUP_NOT_FOUND",
  DatabaseError: "DATABASE_ERROR",
} as const;
export type GroupErrorCode = (typeof GroupErrorCode)[keyof typeof GroupErrorCode];

export interface GroupError {
  readonly code: GroupErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export interface GroupRepository {
  findById(id: string): ResultAsync<Group, GroupError>;
}
