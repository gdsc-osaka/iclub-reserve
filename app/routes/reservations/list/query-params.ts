import type {
  ReservationListPeriodFilter,
  ReservationListStatusFilter,
} from "~/usecases/reservation/get-reservation-list";

/** パース済みの URL クエリパラメータ */
export interface ParsedReservationListParams {
  /** 選択中の団体 ID（/reservations のみ。未指定は null） */
  readonly group: string | null;
  /** ステータス絞り込み（all / provisional / approved / ended） */
  readonly status: ReservationListStatusFilter;
  /** 期間（upcoming / past） */
  readonly period: ReservationListPeriodFilter;
  /** 施設・設備 ID（未指定は null） */
  readonly facility: string | null;
}

const validStatuses: readonly ReservationListStatusFilter[] = [
  "all",
  "provisional",
  "approved",
  "ended",
];

const validPeriods: readonly ReservationListPeriodFilter[] = ["upcoming", "past"];

/**
 * URL のクエリパラメータを安全にパースする。
 *
 * 値が未指定や壊れている場合でもエラーにせず、既定値に安全にフォールバックする。
 * - status: /reservations は "all"、/staff/reservations は "provisional"
 * - period: "upcoming"
 * - facility: null
 * - group: null（/reservations のみ。ユースケース層で所属団体の先頭へ解決される）
 */
export const parseReservationListParams = (
  searchParams: URLSearchParams,
  scope: "own" | "all",
): ParsedReservationListParams => {
  const rawGroup = searchParams.get("group");
  const group =
    scope === "own" && rawGroup !== null && rawGroup.trim() !== "" ? rawGroup.trim() : null;

  const rawStatus = searchParams.get("status") as ReservationListStatusFilter | null;
  const defaultStatus: ReservationListStatusFilter = scope === "all" ? "provisional" : "all";
  const status =
    rawStatus !== null && validStatuses.includes(rawStatus) ? rawStatus : defaultStatus;

  const rawPeriod = searchParams.get("period") as ReservationListPeriodFilter | null;
  const period = rawPeriod !== null && validPeriods.includes(rawPeriod) ? rawPeriod : "upcoming";

  const rawFacility = searchParams.get("facility");
  const facility = rawFacility !== null && rawFacility.trim() !== "" ? rawFacility.trim() : null;

  return {
    group,
    status,
    period,
    facility,
  };
};

/**
 * 絞り込み条件から URL パスを組み立てる。
 *
 * 画面上の切り替えリンク（タブ・ピル）や Select からの遷移先パスとして使用する。
 */
export const toReservationListPath = (
  params: Partial<ParsedReservationListParams>,
  scope: "own" | "all",
): string => {
  const basePath = scope === "all" ? "/staff/reservations" : "/reservations";
  const search = new URLSearchParams();

  if (
    scope === "own" &&
    params.group !== undefined &&
    params.group !== null &&
    params.group !== ""
  ) {
    search.set("group", params.group);
  }

  const defaultStatus: ReservationListStatusFilter = scope === "all" ? "provisional" : "all";
  if (params.status !== undefined && params.status !== defaultStatus) {
    search.set("status", params.status);
  }

  if (params.period !== undefined && params.period !== "upcoming") {
    search.set("period", params.period);
  }

  if (params.facility !== undefined && params.facility !== null && params.facility !== "") {
    search.set("facility", params.facility);
  }

  const query = search.toString();
  return query === "" ? basePath : `${basePath}?${query}`;
};
