import type { ResultAsync } from "neverthrow";
import { ErrorKind, type BaseError } from "../error";

export interface Facility {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  description: string | null;
}

/**
 * 施設まわりのエラーコード。
 *
 * 列挙子の名前は型名を繰り返さないが、文字列の値は変えないこと（ADR-004 決定 1）。
 * ログに出るのは値の方なので、変えると過去のログと突き合わせられなくなる。
 */
export const FacilityErrorCode = {
  /** 施設・設備が存在しない */
  NotFound: "FACILITY_NOT_FOUND",
  DatabaseError: "DATABASE_ERROR",
} as const;
export type FacilityErrorCode = (typeof FacilityErrorCode)[keyof typeof FacilityErrorCode];

/**
 * 施設まわりのエラーコードの分類（ADR-004 決定 3）。
 *
 * HTTP の status とログのレベルは、この表から決まる。
 */
export const facilityErrorKind: Record<FacilityErrorCode, ErrorKind> = {
  [FacilityErrorCode.NotFound]: ErrorKind.NotFound,
  [FacilityErrorCode.DatabaseError]: ErrorKind.Internal,
};

export interface FacilityError extends BaseError {
  readonly code: FacilityErrorCode;
}

export interface FacilityRepository {
  findById(id: string): ResultAsync<Facility, FacilityError>;
}

/**
 * 施設・設備を利用できる時間帯（日本時間）。開始時刻を含み、終了時刻は含まない。
 *
 * 全施設で同じ値にしているのは、INFO-002（施設/設備）に利用可能時間の属性が無いため。
 * 施設ごとに変えたくなったら、まず INFO-002 に属性を足すこと。
 * ここを施設ごとの分岐で増やすと、情報モデルに無い値が画面の中だけで増えていく。
 *
 * 空き状況カレンダー（SCR-001）の時間軸は、この 2 つの値だけで決まる。
 */
export const FACILITY_OPEN_HOUR = 9;
export const FACILITY_CLOSE_HOUR = 21;
