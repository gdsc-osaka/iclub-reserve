import { AuditLogEntryList } from "~/components/audit-log/audit-log-entry-list";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { ReservationAuditLogsView } from "~/query/reservation/reservation-detail";

export interface ReservationAuditLogCardProps {
  readonly auditLogs: ReservationAuditLogsView;
}

/**
 * 予約詳細・メッセージ画面（SCR-005）の操作履歴カード。
 *
 * 全項目を見られる人（自団体のメンバーと事務局。COND-008 の (1)）にのみ表示される。
 * 予約に関する操作履歴を新しい順に表示し、自団体のメンバーには事務局員の個人名を伏せて「事務局」として表示する（COND-012）。
 */
export function ReservationAuditLogCard({ auditLogs }: Readonly<ReservationAuditLogCardProps>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">操作履歴</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <AuditLogEntryList
          items={auditLogs.items}
          page={auditLogs.page}
          hasNextPage={auditLogs.hasNextPage}
          userNames={auditLogs.userNames}
          facilityNames={auditLogs.facilityNames}
          showTargetType={false}
        />
      </CardContent>
    </Card>
  );
}
