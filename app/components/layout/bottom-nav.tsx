import { cn } from "cn";
import { LogOut, MoreHorizontal, Plus, Settings } from "lucide-react";
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
import { useSignOut } from "~/lib/auth/use-sign-out";

import { toNewReservationPath } from "~/lib/reservation-paths";
import { UserAvatar } from "./account-menu";
import type { AppArea } from "~/lib/app-area";
import { NavCountBadge, NavCountDot, NavCountText } from "./nav-count";
import {
  hasAnyNavCount,
  isNavItemActive,
  toBottomNavItems,
  toNavCount,
  toNewReservationLabel,
  toOverflowNavItems,
  type NavCounts,
  type NavItem,
} from "./nav-items";
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
export function BottomNav({
  user,
  area,
  counts,
}: Readonly<{
  user: ShellUser;
  area: AppArea;
  counts: NavCounts;
}>) {
  const items = toBottomNavItems(area);
  const overflowItems = toOverflowNavItems(area);

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
        {items.slice(0, 2).map((item) => (
          <li key={item.id}>
            <BottomNavTab item={item} count={toNavCount(counts, item)} />
          </li>
        ))}

        {/* 入口は真ん中（2 つ目と 3 つ目の間）に置く（ADR-014 決定 9） */}
        <li>
          <BottomNavAction area={area} />
        </li>

        {items.slice(2).map((item) => (
          <li key={item.id}>
            <BottomNavTab item={item} count={toNavCount(counts, item)} />
          </li>
        ))}

        {/* 5 つ目は、残りの項目とアカウント操作をまとめた「その他」に使う */}
        <li>
          <OverflowMenu user={user} items={overflowItems} counts={counts} />
        </li>
      </ul>
    </nav>
  );
}

/** ボトムバーの真ん中に置く、予約の申請（事務局は作成）の入口 */
function BottomNavAction({ area }: Readonly<{ area: AppArea }>) {
  const label = toNewReservationLabel(area);

  return (
    <Link to={toNewReservationPath(area)} className={cn(tabClassName, "text-muted-foreground")}>
      {/*
       * セル自体が Link なので、中に Button は入れず span で丸を描く。
       * 他のタブと同じく高さ h-14 の中に収めるため size-10 にする。
       */}
      <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
        <Plus aria-hidden className="size-5" />
      </span>
      <span>{label}</span>
    </Link>
  );
}

/** ボトムバーの押しやすさを決めている共通のかたち。高さは指で押せる 3.5rem を確保する。 */
const tabClassName =
  "flex h-14 w-full flex-col items-center justify-center gap-1 text-[10px] leading-none";

/** ボトムバーのタブ 1 つ分。 */
function BottomNavTab({ item, count }: Readonly<{ item: NavItem; count: number | undefined }>) {
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
      {/* 件数はアイコンの右上に重ねる。タブの下に足すと、タブの高さが項目ごとに揃わなくなる */}
      <span className="relative flex">
        <Icon aria-hidden className="size-5" />
        {count !== undefined && (
          <NavCountBadge count={count} className="absolute -top-1.5 left-3.5" />
        )}
      </span>
      <span className={cn(isActive && "font-medium")}>
        {item.label}
        {count !== undefined && <NavCountText count={count} />}
      </span>
    </Link>
  );
}

/**
 * ボトムバーに並びきらなかった項目と、アカウントの操作をまとめたシート。
 *
 * 下から出しているのは、開いた直後の指の位置がそのまま使えるようにするため。
 */
function OverflowMenu({
  user,
  items,
  counts,
}: Readonly<{ user: ShellUser; items: readonly NavItem[]; counts: NavCounts }>) {
  const { signOut, isSigningOut } = useSignOut();

  /*
   * 中の項目に件数があれば、「その他」にも点を付ける。付けないと、シートを開くまで気づけない。
   * 数字にしないのは、種類の違う件数（承認待ちの予約と団体など）を足しても意味が無いため。
   */
  const hasCountInside = hasAnyNavCount(counts, items);

  return (
    <Sheet>
      <SheetTrigger className={cn(tabClassName, "text-muted-foreground")}>
        <span className="relative flex">
          <MoreHorizontal aria-hidden className="size-5" />
          {hasCountInside && <NavCountDot className="absolute -top-0.5 -right-0.5" />}
        </span>
        <span>
          その他
          {hasCountInside && <span className="sr-only">（件数のある項目があります）</span>}
        </span>
      </SheetTrigger>

      <SheetContent side="bottom" className="rounded-t-xl pb-[env(safe-area-inset-bottom)]">
        <SheetHeader>
          <SheetTitle>メニュー</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-1 px-4">
          {items.map((item) => (
            <OverflowMenuItem key={item.id} item={item} count={toNavCount(counts, item)} />
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

          <SheetClose asChild>
            <Button variant="outline" asChild>
              <Link to="/account">
                <Settings aria-hidden className="size-4" />
                アカウント設定
              </Link>
            </Button>
          </SheetClose>

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
function OverflowMenuItem({ item, count }: Readonly<{ item: NavItem; count: number | undefined }>) {
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
        {count !== undefined && (
          <>
            <NavCountText count={count} />
            <NavCountBadge count={count} className="ml-auto" />
          </>
        )}
      </Link>
    </SheetClose>
  );
}
