import { Link } from "react-router";

import { formatChanges } from "~/components/audit-log/format-changes";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { auditLogActionLabel, auditLogTargetTypeLabel } from "~/domain/audit-log";
import { formatDateTime } from "~/lib/date";
import type { GroupAuditLogEntry } from "~/usecases/group/get-group-management";

export interface GroupAuditLogCardProps {
  readonly groupId: string;
  readonly auditLogs: {
    readonly items: readonly GroupAuditLogEntry[];
    readonly hasNextPage: boolean;
    readonly page: number;
    readonly userNames: Readonly<Record<string, string>>;
  };
  readonly isStaff: boolean;
}

/**
 * 団体管理画面（SCR-007）の操作履歴カード。
 *
 * 管理者および事務局スタッフのみに表示される。
 * 団体・メンバーシップ・招待に関する操作履歴を新しい順に表示し、
 * 自団体の管理者には事務局員の個人名を伏せて「事務局」として表示する（COND-012）。
 */
export function GroupAuditLogCard({
  groupId,
  auditLogs,
  isStaff,
}: Readonly<GroupAuditLogCardProps>) {
  const { items, hasNextPage, page, userNames } = auditLogs;

  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>操作履歴</CardTitle>
        {isStaff && (
          <Link
            to={`/staff/audit-log?group=${groupId}`}
            className="text-sm font-medium text-primary underline underline-offset-4 hover:text-primary/80"
          >
            操作履歴画面で見る
          </Link>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだ操作履歴はありません。</p>
        ) : (
          <ol aria-label="操作履歴" className="flex flex-col gap-3">
            {items.map((item) => {
              const occurredAtDate = new Date(item.occurredAt);
              const formattedChanges = formatChanges(item.changes, {
                targetType: item.targetType,
                userNames,
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
                        <Badge variant="outline">{auditLogTargetTypeLabel[item.targetType]}</Badge>
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

        {/* ページ送りリンク */}
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
      </CardContent>
    </Card>
  );
}
