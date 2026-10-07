import { Link } from "react-router";

import { formatChanges } from "~/components/audit-log/format-changes";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import {
  auditLogActionLabel,
  auditLogTargetTypeLabel,
  type AuditLogEntryView,
} from "~/domain/audit-log";
import { formatDateTime } from "~/lib/date";

export interface AuditLogEntryListProps {
  readonly items: readonly AuditLogEntryView[];
  readonly page: number;
  readonly hasNextPage: boolean;
  readonly userNames: Readonly<Record<string, string>>;
  readonly facilityNames?: Readonly<Record<string, string>>;
  readonly showTargetType?: boolean;
}

/**
 * 操作履歴の一覧表示コンポーネント（SCR-007 / SCR-005 共通）。
 *
 * 操作履歴のリスト表示、空メッセージ表示、およびページ送りリンクを提供する。
 */
export function AuditLogEntryList({
  items,
  page,
  hasNextPage,
  userNames,
  facilityNames,
  showTargetType = true,
}: Readonly<AuditLogEntryListProps>) {
  return (
    <>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだ操作履歴はありません。</p>
      ) : (
        <ol aria-label="操作履歴" className="flex flex-col gap-3">
          {items.map((item) => {
            const occurredAtDate = new Date(item.occurredAt);
            const formattedChanges = formatChanges(item.changes, {
              targetType: item.targetType,
              userNames,
              facilityNames,
            });

            return (
              <li key={item.id}>
                <Card>
                  <CardContent className="flex flex-col gap-3">
                    {/* ヘッダー行: 操作者・権限バッジ・日時 */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-xs text-muted-foreground sm:text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        {item.actor.kind === "staff" ? (
                          <span className="font-semibold text-foreground">事務局</span>
                        ) : (
                          <>
                            <span className="font-semibold text-foreground">
                              {item.actor.name ?? "（削除されたユーザー）"}
                            </span>
                            {item.actor.actedAsStaff && (
                              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                事務局権限
                              </Badge>
                            )}
                          </>
                        )}
                      </div>
                      <time dateTime={occurredAtDate.toISOString()}>
                        {formatDateTime(occurredAtDate)}
                      </time>
                    </div>

                    {/* 対象の種類・操作名 */}
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {showTargetType && (
                        <Badge variant="outline">{auditLogTargetTypeLabel[item.targetType]}</Badge>
                      )}
                      <span className="font-semibold">{auditLogActionLabel[item.action]}</span>
                    </div>

                    {/* 変更内容のリスト */}
                    {formattedChanges.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {formattedChanges.map((change) => (
                          <span
                            key={change.key}
                            className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                          >
                            {change.displayText}
                          </span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      )}

      {/* ページ送りリンク。1 ページに収まるときは、中身の無い nav を出さない */}
      {(page > 1 || hasNextPage) && (
        <nav aria-label="操作履歴のページ送り" className="flex items-center justify-between pt-2">
          <div>
            {page > 1 ? (
              <Link
                to={page === 2 ? "." : `?historyPage=${page - 1}`}
                preventScrollReset
                className="text-sm font-medium text-primary hover:underline"
              >
                ← 新しい履歴
              </Link>
            ) : (
              <span />
            )}
          </div>
          <div>
            {hasNextPage ? (
              <Link
                to={`?historyPage=${page + 1}`}
                preventScrollReset
                className="text-sm font-medium text-primary hover:underline"
              >
                古い履歴 →
              </Link>
            ) : (
              <span />
            )}
          </div>
        </nav>
      )}
    </>
  );
}
