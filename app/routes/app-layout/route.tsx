import { useEffect, useState } from "react";
import { env } from "cloudflare:workers";
import { cn } from "cn";
import { Outlet, useLocation, type ShouldRevalidateFunctionArgs } from "react-router";

import { resolveShellArea, toAreaFromPathname } from "~/components/layout/app-area";
import { DesktopHeader, MobileHeader } from "~/components/layout/app-header";
import { AppSidebar } from "~/components/layout/app-sidebar";
import { BottomNav } from "~/components/layout/bottom-nav";
import { readLastArea, rememberLastArea } from "~/components/layout/last-area-cookie";
import type { ShellUser } from "~/components/layout/shell-user";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { TooltipProvider } from "~/components/ui/tooltip";
import { createDb } from "~/infra/db";
import { requireRequestUser } from "~/lib/auth/auth-session.server";

import type { Route } from "./+types/route";
import { shouldRecountNavCounts } from "./nav-counts";
import { loadNavCounts } from "./nav-counts.server";
import { readSidebarDefaultOpen } from "./sidebar-cookie";

/**
 * 画面の共通部分に必要なものだけを渡す。
 *
 * DB へ問い合わせるのは、ナビに添える件数（承認待ちなど）を数えるときだけにする。
 * 共通部分はどの画面でも動くので、ここが DB の不調で落ちるとアプリ全体が真っ白になる。
 * そのため件数は数えられなくても例外にせず、その件数を出さずに画面を開く（`loadNavCounts`）。
 * 所属団体のような画面ごとのデータは、それを使う画面（ダッシュボードなど）の側で取る。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);

  const shellUser: ShellUser = {
    name: user.name,
    email: user.email,
    isStaff: user.is_staff,
  };

  return {
    user: shellUser,
    sidebarDefaultOpen: readSidebarDefaultOpen(request),
    lastArea: user.is_staff ? readLastArea(request) : null,
    navCounts: await loadNavCounts(createDb(env.DB), user, new Date()),
  };
}

/**
 * 画面を移るたびに件数を数え直さないよう、この loader を走らせ直す時期を絞る（#189）。
 *
 * 走らせ直すのは、件数を持つタブを開いたとき・GET 以外の送信のあと・同じ URL の読み直しだけ。
 * それ以外の移動では、前に数えた件数と利用者の情報をそのまま使う。
 * どの場合に走らせ直すかは `shouldRecountNavCounts` に書いている。
 */
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return shouldRecountNavCounts(args);
}

/**
 * ログイン後の画面すべてに共通の外枠（シェル）。
 *
 * 横長の画面（PC・タブレット）では左のサイドバー、
 * 縦長の画面（スマホ）では下のボトムバーでナビゲーションを出す。
 * どちらを出すかは CSS の画面幅だけで決めていて、JavaScript では判定していない。
 * `useIsMobile()` のような判定は画面が出たあとに走るため、
 * スマホでサイドバーが一瞬見えてから消える、といったちらつきが起きる。
 *
 * ログイン前の画面（ログイン・初回セットアップ・パスキーの案内）は
 * この外枠の外側に置いている。ログインしていない人にナビゲーションを見せても
 * 押せる項目が無いため。
 */
export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { user, sidebarDefaultOpen, navCounts, lastArea: initialLastArea } = loaderData;
  const { pathname } = useLocation();

  const pathArea = toAreaFromPathname(pathname);
  const [lastArea, setLastArea] = useState(initialLastArea);

  /*
   * 外枠に出す領域を決定する（ADR-016 決定 3）。
   * 事務局の画面から予約の詳細やアカウント設定を開いたときに、ナビが利用者の画面のものに
   * 変わるとどこにいるか分からなくなるため、「どちらでもない」画面では最後に開いていた画面のナビを出す。
   */
  const area = resolveShellArea({ isStaff: user.isStaff, pathArea, lastArea });

  useEffect(() => {
    if (pathArea !== null) {
      setLastArea(pathArea);
      if (user.isStaff) {
        rememberLastArea(pathArea);
      }
    }
  }, [pathArea, user.isStaff]);

  return (
    /*
     * サイドバーを畳んだときに出る吹き出し（ツールチップ）は、
     * TooltipProvider の中でしか動かない。囲み忘れると、
     * 畳んだ瞬間に画面全体が「Tooltip must be used within TooltipProvider」で落ちる。
     */
    <TooltipProvider>
      <SidebarProvider defaultOpen={sidebarDefaultOpen}>
        <AppSidebar user={user} area={area} counts={navCounts} />

        <SidebarInset>
          <MobileHeader user={user} area={area} counts={navCounts} />
          <DesktopHeader area={area} />

          {/*
           * ボトムバーは画面の下端に固定されているので、
           * その分だけ下に余白を空けておかないと最後の行が隠れて読めなくなる。
           *
           * --app-header-height は「アプリの上部バーの高さ」。
           * 上部バーのすぐ下に要素を固定（sticky）したい画面（予約一覧の見出しなど）が
           * `top-(--app-header-height)` で使う。
           *
           * --app-content-height は「上下の帯を除いた、中身に使える高さ」。
           * 画面をスクロールさせず中身だけをスクロールさせたい画面
           * （空き状況カレンダーなど）が `h-(--app-content-height)` で使う。
           * 帯の高さを各画面に書き写すと、帯の高さを変えたときに
           * 直し漏れた画面だけが縦にはみ出す。
           */}
          <div
            className={cn(
              "flex flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0",
              // 上の帯の高さ（スマホ 3.5rem、PC・タブレット 3rem）
              "[--app-header-height:3.5rem] md:[--app-header-height:3rem]",
              // スマホ: 上の帯（--app-header-height） + ボトムバー 3.5rem（+ ホームバーの余白）
              "[--app-content-height:calc(100svh_-_var(--app-header-height)_-_3.5rem_-_env(safe-area-inset-bottom))]",
              // PC・タブレット: 上の帯（--app-header-height）のみ
              "md:[--app-content-height:calc(100svh_-_var(--app-header-height))]",
            )}
          >
            <Outlet />
          </div>

          <BottomNav user={user} area={area} counts={navCounts} />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
