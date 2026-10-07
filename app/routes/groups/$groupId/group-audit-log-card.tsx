import { Link } from "react-router";

import { AuditLogEntryList } from "~/components/audit-log/audit-log-entry-list";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { AuditLogEntryView } from "~/domain/audit-log";

export interface GroupAuditLogCardProps {
  readonly groupId: string;
  readonly auditLogs: {
    readonly items: readonly AuditLogEntryView[];
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
        <AuditLogEntryList
          items={auditLogs.items}
          page={auditLogs.page}
          hasNextPage={auditLogs.hasNextPage}
          userNames={auditLogs.userNames}
        />
      </CardContent>
    </Card>
  );
}
