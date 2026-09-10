import { LogOut, MoreHorizontal } from "lucide-react";
import { Link, useLocation } from "react-router";

import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import { cn } from "~/lib/utils";
import { useSignOut } from "~/lib/auth/use-sign-out";

import { UserAvatar } from "./account-menu";
import { isNavItemActive, toBottomNavItems, toOverflowNavItems, type NavItem } from "./nav-items";
import type { ShellUser } from "./shell-user";

/**
 * 縦長の画面（スマホ）で下端に出すナビゲーション。
 *
 * サイドバーではなくボトムバーにしているのは、スマホでは片手で持ったときに
 * 親指が届くのが画面の下側だから。上端に置くと、操作のたびに持ち替えることになる。
 *
 * 出し分けは CSS の画面幅（md 未満）で行っている。
 * `useIsMobile()` のような JavaScript での判定は、最初の描画に間に合わず
 * サイドバーとボトムバーが一瞬両方出てしまう。
 */
export function BottomNav({ user }: Readonly<{ user: ShellUser }>) {
  const items = toBottomNavItems(user.isStaff);
  const overflowItems = toOverflowNavItems(user.isStaff);

  return (
    <nav
      aria-label="メインメニュー"
      /*
       * iPhone のホームバーに重ならないよう、下に safe-area の分だけ余白を足す。
       * これが無いと、いちばん下の行が指で押せない位置に入り込む。
       */
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => (
          <li key={item.id}>
            <BottomNavTab item={item} />
          </li>
        ))}

        {/* 5 つ目は、残りの項目とアカウント操作をまとめた「その他」に使う */}
        <li>
          <OverflowMenu user={user} items={overflowItems} />
        </li>
      </ul>
    </nav>
  );
}

/** ボトムバーの押しやすさを決めている共通のかたち。高さは指で押せる 3.5rem を確保する。 */
const tabClassName =
  "flex h-14 w-full flex-col items-center justify-center gap-1 text-[10px] leading-none";

/** ボトムバーのタブ 1 つ分。 */
function BottomNavTab({ item }: Readonly<{ item: NavItem }>) {
  const { pathname } = useLocation();
  const Icon = item.icon;

  if (!item.enabled) {
    return (
      <button type="button" disabled className={cn(tabClassName, "text-muted-foreground/50")}>
        <Icon aria-hidden className="size-5" />
        <span>{item.label}</span>
      </button>
    );
  }

  const isActive = isNavItemActive(item, pathname);

  return (
    <Link
      to={item.to}
      aria-current={isActive ? "page" : undefined}
      className={cn(tabClassName, isActive ? "text-primary" : "text-muted-foreground")}
    >
      <Icon aria-hidden className="size-5" />
      <span className={cn(isActive && "font-medium")}>{item.label}</span>
    </Link>
  );
}

/**
 * ボトムバーに並びきらなかった項目と、アカウントの操作をまとめたシート。
 *
 * 下から出しているのは、開いた直後の指の位置がそのまま使えるようにするため。
 */
function OverflowMenu({ user, items }: Readonly<{ user: ShellUser; items: readonly NavItem[] }>) {
  const { signOut, isSigningOut } = useSignOut();

  return (
    <Sheet>
      <SheetTrigger className={cn(tabClassName, "text-muted-foreground")}>
        <MoreHorizontal aria-hidden className="size-5" />
        <span>その他</span>
      </SheetTrigger>

      <SheetContent side="bottom" className="rounded-t-xl pb-[env(safe-area-inset-bottom)]">
        <SheetHeader>
          <SheetTitle>メニュー</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-1 px-4">
          {items.map((item) => (
            <OverflowMenuItem key={item.id} item={item} />
          ))}
        </div>

        <Separator className="my-2" />

        <div className="flex flex-col gap-2 px-4 pb-4">
          <div className="flex items-center gap-2 px-3 py-1">
            <UserAvatar user={user} />
            <div className="grid flex-1 text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={isSigningOut}
            onClick={() => void signOut()}
          >
            <LogOut aria-hidden />
            ログアウト
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** 「その他」の中に並べる 1 行。 */
function OverflowMenuItem({ item }: Readonly<{ item: NavItem }>) {
  const { pathname } = useLocation();
  const Icon = item.icon;
  const rowClassName = "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm";

  if (!item.enabled) {
    return (
      <span className={cn(rowClassName, "text-muted-foreground/60")}>
        <Icon aria-hidden className="size-4" />
        {item.label}
        <span className="ml-auto text-[10px]">準備中</span>
      </span>
    );
  }

  return (
    // 行き先へ移動したらシートは閉じる。開いたままだと画面が隠れてしまう
    <SheetClose asChild>
      <Link
        to={item.to}
        className={cn(rowClassName, isNavItemActive(item, pathname) && "bg-accent font-medium")}
      >
        <Icon aria-hidden className="size-4" />
        {item.label}
      </Link>
    </SheetClose>
  );
}
