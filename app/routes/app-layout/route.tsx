import { Outlet } from "react-router";

import { DesktopHeader, MobileHeader } from "~/components/layout/app-header";
import { AppSidebar } from "~/components/layout/app-sidebar";
import { BottomNav } from "~/components/layout/bottom-nav";
import type { ShellUser } from "~/components/layout/shell-user";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { TooltipProvider } from "~/components/ui/tooltip";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { cn } from "~/lib/utils";

import type { Route } from "./+types/route";
import { readSidebarDefaultOpen } from "./sidebar-cookie";

/**
 * 画面の共通部分に必要なものだけを渡す。
 *
 * ここで DB へ問い合わせないのは、共通部分がどの画面でも必ず動くようにするため。
 * 共通部分が DB に依存すると、DB が不調なときにアプリ全体が真っ白になる。
 * 所属団体のようなデータは、それを使う画面（ダッシュボードなど）の側で取る。
 */
export function loader({ request, context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);

  const shellUser: ShellUser = {
    name: user.name,
    email: user.email,
    isStaff: user.is_staff,
  };

  return { user: shellUser, sidebarDefaultOpen: readSidebarDefaultOpen(request) };
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
  const { user, sidebarDefaultOpen } = loaderData;

  return (
    /*
     * サイドバーを畳んだときに出る吹き出し（ツールチップ）は、
     * TooltipProvider の中でしか動かない。囲み忘れると、
     * 畳んだ瞬間に画面全体が「Tooltip must be used within TooltipProvider」で落ちる。
     */
    <TooltipProvider>
      <SidebarProvider defaultOpen={sidebarDefaultOpen}>
        <AppSidebar user={user} />

        <SidebarInset>
          <MobileHeader user={user} />
          <DesktopHeader user={user} />

          {/*
           * ボトムバーは画面の下端に固定されているので、
           * その分だけ下に余白を空けておかないと最後の行が隠れて読めなくなる。
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
              // スマホ: 上の帯 3.5rem + ボトムバー 3.5rem（+ ホームバーの余白）
              "[--app-content-height:calc(100svh_-_3.5rem_-_3.5rem_-_env(safe-area-inset-bottom))]",
              // PC・タブレット: 上の帯 3rem のみ
              "md:[--app-content-height:calc(100svh_-_3rem)]",
            )}
          >
            <Outlet />
          </div>

          <BottomNav user={user} />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
