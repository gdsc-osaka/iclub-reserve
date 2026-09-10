import { Link, useLocation } from "react-router";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "~/components/ui/sidebar";

import { AccountMenu } from "./account-menu";
import { BrandHeader } from "./brand-header";
import { commonNavItems, isNavItemActive, staffNavItems, type NavItem } from "./nav-items";
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
export function AppSidebar({ user }: Readonly<{ user: ShellUser }>) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <BrandHeader />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {commonNavItems.map((item) => (
                <NavMenuItem key={item.id} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/*
         * 事務局の項目は、共通の項目を置き換えずに下へ足す。
         * 事務局の人も自分の団体の予約を申請するし、
         * どの団体にも所属していない事務局の人もいるため。
         */}
        {user.isStaff && (
          <SidebarGroup>
            <SidebarGroupLabel>事務局</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {staffNavItems.map((item) => (
                  <NavMenuItem key={item.id} item={item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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
function NavMenuItem({ item }: Readonly<{ item: NavItem }>) {
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
      <SidebarMenuButton asChild isActive={isNavItemActive(item, pathname)} tooltip={item.label}>
        <Link to={item.to}>
          <Icon aria-hidden />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
