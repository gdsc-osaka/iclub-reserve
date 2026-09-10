import { env } from "cloudflare:workers";
import { ChevronRight, CircleAlert, Clock, Users } from "lucide-react";
import { Link } from "react-router";

import { GroupStatusBadge } from "~/components/group/group-status-badge";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { createDb } from "~/infra/db";
import { createGroupRepository } from "~/infra/group/group-repo";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { listMyGroupsUseCase } from "~/usecases/group/list-my-groups";

import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [{ title: "ダッシュボード | iclub-reserve" }];
}

/** ダッシュボードに出す団体 1 件分。画面で使う項目だけに絞っている。 */
interface DashboardGroup {
  readonly id: string;
  readonly name: string;
  readonly status: GroupStatus;
  /** その団体の管理者かどうか。メンバーの招待などができる。 */
  readonly isAdmin: boolean;
}

/**
 * ダッシュボードに出すデータを取る。
 *
 * この画面はログイン後の行き先なので、一部が取れなくても開けるようにしている。
 * 団体の一覧が取れないときに 500 を返すと、ログインした人が
 * どこにも行けない状態になってしまう。
 */
export async function loader({ context }: Route.LoaderArgs) {
  // この画面はログイン必須 (root.tsx のミドルウェアが先に確認している)
  const user = requireRequestUser(context);

  const groupsResult = await listMyGroupsUseCase(
    { groupRepository: createGroupRepository(createDb(env.DB)) },
    { actorUserId: user.id },
  );

  if (groupsResult.isErr()) {
    return { groups: [] as readonly DashboardGroup[], isGroupsUnavailable: true };
  }

  const groups = groupsResult.value.map(
    ({ group, roles }): DashboardGroup => ({
      id: group.id,
      name: group.name,
      status: group.status,
      isAdmin: roles.includes(MembershipRole.Admin),
    }),
  );

  return { groups, isGroupsUnavailable: false };
}

/**
 * ログイン後に最初に開く画面。
 *
 * 所属している団体を横断して、いま自分に関係することをまとめて出す。
 * 団体を切り替えて見る形にしていないのは、複数の団体を掛け持ちしている人が多く、
 * 切り替えを忘れたまま「予約が無い」と勘違いするのを避けたいため。
 *
 * NOTE: 「今後の予約」と「今週の空き状況」はここに並べる予定だが、
 * 予約と施設の読み取りがまだ無いので置いていない。
 * 中身の無いカードを先に並べても、見た人には何も分からない。
 */
export default function Home({ loaderData }: Route.ComponentProps) {
  const { groups, isGroupsUnavailable } = loaderData;
  const pendingGroups = groups.filter((group) => group.status === GroupStatus.Pending);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      {isGroupsUnavailable && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle>所属している団体を読み込めませんでした</AlertTitle>
          <AlertDescription>
            時間をおいて、画面を再読み込みしてください。
            繰り返し表示される場合は事務局にご連絡ください。
          </AlertDescription>
        </Alert>
      )}

      {pendingGroups.length > 0 && <PendingGroupsNotice groups={pendingGroups} />}

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Users aria-hidden className="size-4" />
          所属団体
        </h2>

        {groups.length === 0 ? (
          !isGroupsUnavailable && <NoGroupsCard />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {groups.map((group) => (
              <li key={group.id}>
                <GroupCard group={group} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/**
 * 団体が承認待ちのあいだに出す案内。
 *
 * 承認待ちの団体からは予約を申請できない（COND-006）。
 * 理由を書かずに申請だけできない状態にすると、
 * 不具合だと思って何度も試すことになる。
 *
 * 画面全体ではなく団体ごとに出しているのは、
 * 複数の団体に所属していると団体ごとに状態が違うため。
 */
function PendingGroupsNotice({ groups }: Readonly<{ groups: readonly DashboardGroup[] }>) {
  return (
    <Alert className="border-amber-500/30 bg-amber-500/5">
      <Clock aria-hidden className="text-amber-600 dark:text-amber-400" />
      <AlertTitle>承認待ちの団体があります</AlertTitle>
      <AlertDescription>
        {groups.map((group) => group.name).join("、")}
        は事務局の承認を待っています。承認されるまで、この団体では予約を申請できません。
      </AlertDescription>
    </Alert>
  );
}

/**
 * どの団体にも所属していない人に出す案内。
 *
 * NOTE: 団体の登録は、今は事務局しかできない
 * （Better Auth の `allowUserToCreateOrganization` が false）。
 * 誰でも登録できるようになったら、ここに「団体を登録」の導線を足す。
 */
function NoGroupsCard() {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <p className="text-sm font-medium">まだどの団体にも所属していません</p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        団体に招待されると、ここに表示されます。
        <br />
        新しく団体を登録したいときは、事務局にご連絡ください。
      </p>
    </div>
  );
}

/** 所属している団体 1 件分のカード。押すとその団体の画面へ移動する。 */
function GroupCard({ group }: Readonly<{ group: DashboardGroup }>) {
  return (
    <Link
      to={`/groups/${group.id}`}
      className="flex h-full items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-accent"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate font-medium">{group.name}</span>
        <span className="flex items-center gap-2">
          <GroupStatusBadge status={group.status} />
          {group.isAdmin && <span className="text-xs text-muted-foreground">管理者</span>}
        </span>
      </div>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
