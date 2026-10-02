import { Clock } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { GroupStatus } from "~/domain/group";

import type { MyGroup } from "./my-group";

/**
 * 団体が承認待ちのあいだに出す案内。承認待ちの団体が無ければ何も出さない。
 *
 * 承認待ちの団体からは予約を申請できない（COND-006）。
 * 理由を書かずに申請だけできない状態にすると、
 * 不具合だと思って何度も試すことになる。
 *
 * 画面全体ではなく団体ごとに出しているのは、
 * 複数の団体に所属していると団体ごとに状態が違うため。
 *
 * ダッシュボード（/）と所属団体一覧（/groups）の両方で、カードの一覧の上に出す。
 * カードの中に同じ説明を書くと、ダッシュボードで同じ文が 2 度並んでしまう。
 */
export function PendingGroupsNotice({ groups }: Readonly<{ groups: readonly MyGroup[] }>) {
  const pendingGroups = groups.filter((group) => group.status === GroupStatus.Pending);

  if (pendingGroups.length === 0) {
    return null;
  }

  return (
    <Alert className="border-amber-500/30 bg-amber-500/5">
      <Clock aria-hidden className="text-amber-600 dark:text-amber-400" />
      <AlertTitle>承認待ちの団体があります</AlertTitle>
      <AlertDescription>
        {pendingGroups.map((group) => group.name).join("、")}
        は事務局の承認を待っています。承認されるまで、この団体では予約を申請できません。
      </AlertDescription>
    </Alert>
  );
}
