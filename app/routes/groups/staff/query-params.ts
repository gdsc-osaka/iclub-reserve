import type { GroupStatus } from "~/domain/group";

/** 事務局団体管理画面のステータス絞り込みキー */
export type StaffGroupStatusFilter = "pending" | "enabled" | "disabled" | "all";

/** パース済みのクエリパラメータ */
export interface ParsedStaffGroupParams {
  readonly status: StaffGroupStatusFilter;
}

const validStatuses: readonly string[] = [
  "pending",
  "enabled",
  "disabled",
  "all",
] satisfies readonly StaffGroupStatusFilter[];

const isStaffGroupStatusFilter = (value: string): value is StaffGroupStatusFilter =>
  validStatuses.includes(value);

/**
 * URL のクエリパラメータからステータス絞り込み条件を解析する。
 *
 * 既定値は "pending"（待たせている団体を先に処理できるようにするため）。
 * 未指定または不正な値が渡された場合も安全に "pending" に倒す。
 */
export const parseStaffGroupParams = (searchParams: URLSearchParams): ParsedStaffGroupParams => {
  const rawStatus = searchParams.get("status");

  const status = rawStatus !== null && isStaffGroupStatusFilter(rawStatus) ? rawStatus : "pending";

  return { status };
};

/**
 * 絞り込みキーをドメインの GroupStatus | null に変換する。
 *
 * "all" のときは全ステータス対象として null を返す。
 */
export const toDomainGroupStatus = (filter: StaffGroupStatusFilter): GroupStatus | null => {
  if (filter === "all") return null;
  return filter;
};

/**
 * パラメータから URL パスを組み立てる。
 *
 * 既定値（status=pending）のときはクエリを付けないか、指定されたステータスをクエリに付与する。
 */
export const toStaffGroupPath = (params: Partial<ParsedStaffGroupParams>): string => {
  const basePath = "/staff/groups";
  if (params.status === undefined || params.status === "pending") {
    return basePath;
  }

  return `${basePath}?status=${params.status}`;
};
