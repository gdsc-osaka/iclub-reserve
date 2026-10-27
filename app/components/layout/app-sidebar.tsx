import { Plus } from "lucide-react";
import { Link, useLocation } from "react-router";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "~/components/ui/sidebar";

import { toNewReservationPath } from "~/lib/reservation-paths";
import { AccountMenu } from "./account-menu";
import type { AppArea } from "~/lib/app-area";
import { AreaSwitch } from "./area-switch";
import { BrandHeader } from "./brand-header";
import { NavCountBadge, NavCountDot, NavCountText } from "./nav-count";
import {
  isNavItemActive,
  toNavCount,
  toNavItems,
  toNewReservationLabel,
  type NavCounts,
  type NavItem,
} from "./nav-items";
import type { ShellUser } from "./shell-user";

/**
 * 横長の画面（PC・タブレット）で左側に出すナビゲーション。
 *
 * スマホでは代わりにボトムバー（bottom-nav.tsx）を出す。
 * この切り替えは CSS の画面幅で行っていて、`useIsMobile()` は使っていない。
 * あちらは JavaScript が動いたあとに幅を測るので、最初の描画では必ず
 * 「PC 用」と判定され、スマホでは一瞬サイドバーが出てから消える。
 *
 * サイドバーを畳めるようにしているのは見た目の好みではなく、
 * 空き状況カレンダー（SCR-001）が施設 × 時間の表を横に広げるため。
 * 幅が足りないと、表を見るためだけに横スクロールが必要になる。
 */
export function AppSidebar({
  user,
  area,
  counts,
}: Readonly<{
  user: ShellUser;
  area: AppArea;
  counts: NavCounts;
}>) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <BrandHeader area={area} />
        <AreaSwitch user={user} area={area} counts={counts} variant="sidebar" />
      </SidebarHeader>

      <SidebarContent>
        {/* 新規予約の入口。常に最上部に置く（ADR-014 決定 9） */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip={toNewReservationLabel(area)}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/80 active:text-primary-foreground"
                >
                  <Link to={toNewReservationPath(area)}>
                    <Plus aria-hidden />
                    <span>{toNewReservationLabel(area)}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {toNavItems(area).map((item) => (
                <NavMenuItem key={item.id} item={item} count={toNavCount(counts, item)} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <AccountMenu user={user} />
      </SidebarFooter>

      {/* サイドバーの端をつかんで開閉できるようにする細い帯 */}
      <SidebarRail />
    </Sidebar>
  );
}

/**
 * ナビゲーションの 1 項目。
 *
 * まだ画面が無い項目はリンクにせず、押せないボタンとして出す。
 * 隠してしまうと機能が増えるたびに並びが変わって迷わせるうえ、
 * リンクのままにすると 404 に落ちる。
 */
function NavMenuItem({ item, count }: Readonly<{ item: NavItem; count: number | undefined }>) {
  const { pathname } = useLocation();
  const Icon = item.icon;

  if (!item.enabled) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton disabled tooltip={`${item.label}（準備中）`}>
          <Icon aria-hidden />
          <span>{item.label}</span>
        </SidebarMenuButton>
        <SidebarMenuBadge className="bg-sidebar-accent text-[10px] font-normal text-muted-foreground">
          準備中
        </SidebarMenuBadge>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isNavItemActive(item, pathname)}
        // 畳んだときは数字を出す場所が無いので、吹き出しで件数を伝える
        tooltip={count === undefined ? item.label : `${item.label}（${count} 件）`}
      >
        <Link to={item.to}>
          <span className="relative flex shrink-0">
            <Icon aria-hidden />
            {/* 右端の数字（SidebarMenuBadge）は畳むと隠れるので、畳んだときだけアイコンに点を付ける */}
            {count !== undefined && (
              <NavCountDot className="absolute -top-0.5 -right-0.5 hidden group-data-[collapsible=icon]:block" />
            )}
          </span>
          <span>
            {item.label}
            {count !== undefined && <NavCountText count={count} />}
          </span>
        </Link>
      </SidebarMenuButton>
      {count !== undefined && (
        <SidebarMenuBadge>
          <NavCountBadge count={count} />
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );
}
