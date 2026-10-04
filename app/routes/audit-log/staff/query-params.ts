import { parseAuditLogTargetType, type AuditLogTargetType } from "~/domain/audit-log";
import { addDays, parseTokyoDateKey } from "~/lib/date";
import type { AuditLogSearchFilter } from "~/query/audit-log/audit-log-search";

/**
 * URL からパースされた操作履歴検索パラメータ。
 */
export interface ParsedAuditLogSearchParams {
  /** 記録対象の種類 */
  readonly type: AuditLogTargetType | null;
  /** 団体 ID */
  readonly group: string | null;
  /** 操作者 ID */
  readonly actor: string | null;
  /** 開始日（日本時間 YYYY-MM-DD） */
  readonly from: string | null;
  /** 終了日（日本時間 YYYY-MM-DD） */
  readonly to: string | null;
  /** ページ番号（1 始まり） */
  readonly page: number;
  /** ユースケースに渡す絞り込み条件 */
  readonly filter: AuditLogSearchFilter;
}

/**
 * URL のクエリパラメータを安全にパースする。
 *
 * 不正な値や壊れた値があってもエラーにせず、安全に既定値（絞り込みなし・1 ページ目）にフォールバックする。
 */
export const parseAuditLogSearchParams = (
  searchParams: URLSearchParams,
): ParsedAuditLogSearchParams => {
  /*
   * 絞り込みの選択欄の「すべて」は "all" を送る（JavaScript が動かずに GET でそのまま送られたとき）。
   * "all" は対象の種類にも団体・操作者の ID にも無い値なので、空と同じく「絞り込まない」として扱う。
   */
  const type = parseAuditLogTargetType(searchParams.get("type"));

  const rawGroup = searchParams.get("group");
  const group =
    rawGroup !== null && rawGroup.trim() !== "" && rawGroup.trim() !== "all"
      ? rawGroup.trim()
      : null;

  const rawActor = searchParams.get("actor");
  const actor =
    rawActor !== null && rawActor.trim() !== "" && rawActor.trim() !== "all"
      ? rawActor.trim()
      : null;

  const rawFrom = searchParams.get("from");
  const parsedFromDate = rawFrom !== null ? parseTokyoDateKey(rawFrom.trim()) : null;
  const from = parsedFromDate !== null && rawFrom !== null ? rawFrom.trim() : null;
  const occurredFrom = parsedFromDate;

  const rawTo = searchParams.get("to");
  const parsedToDate = rawTo !== null ? parseTokyoDateKey(rawTo.trim()) : null;
  const to = parsedToDate !== null && rawTo !== null ? rawTo.trim() : null;
  // 終了日はその日を含むため、翌日の 0 時より前（lt）として上限時刻を計算する
  const occurredBefore = parsedToDate !== null ? addDays(parsedToDate, 1) : null;

  const rawPage = searchParams.get("page");
  const parsedPage = rawPage !== null ? Number.parseInt(rawPage, 10) : 1;
  const page = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const filter: AuditLogSearchFilter = {
    targetType: type,
    groupId: group,
    actorId: actor,
    occurredFrom,
    occurredBefore,
  };

  return {
    type,
    group,
    actor,
    from,
    to,
    page,
    filter,
  };
};

/**
 * パラメータから操作履歴画面の URL パスを組み立てる。
 *
 * 既定値（null や 1 ページ目）の項目は URL を簡潔に保つため除外する。
 */
export const toAuditLogSearchPath = (
  params: Partial<Omit<ParsedAuditLogSearchParams, "filter">>,
): string => {
  const basePath = "/staff/audit-log";
  const search = new URLSearchParams();

  if (params.type) {
    search.set("type", params.type);
  }
  if (params.group) {
    search.set("group", params.group);
  }
  if (params.actor) {
    search.set("actor", params.actor);
  }
  if (params.from) {
    search.set("from", params.from);
  }
  if (params.to) {
    search.set("to", params.to);
  }
  if (params.page !== undefined && params.page > 1) {
    search.set("page", String(params.page));
  }

  const query = search.toString();
  return query === "" ? basePath : `${basePath}?${query}`;
};
