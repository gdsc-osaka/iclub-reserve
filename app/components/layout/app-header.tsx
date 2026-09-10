import { useLocation } from "react-router";

import { IclubMark } from "~/components/brand/iclub-logo";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";

import { findActiveNavItem } from "./nav-items";
import type { ShellUser } from "./shell-user";

/** このシステムの名前。ロゴ（団体の名前）と組にして出す。 */
const SERVICE_NAME = "施設・設備 予約システム";

/**
 * 横長の画面（PC・タブレット）の上部に出す帯。
 *
 * サイドバーを畳んだあと、確実に開き直せる場所が要るので開閉ボタンを置いている。
 * サイドバーの端（SidebarRail）でも開閉できるが、そこにボタンがあることに
 * 気づけない人が多い。
 */
export function DesktopHeader({ user }: Readonly<{ user: ShellUser }>) {
  const { pathname } = useLocation();
  const activeItem = findActiveNavItem(user.isStaff, pathname);

  return (
    <header className="sticky top-0 z-20 hidden h-12 shrink-0 items-center gap-2 border-b bg-background px-4 md:flex">
      <SidebarTrigger className="-ms-1" />
      {/*
       * 高さを指定せず、帯の高さいっぱいに引く。
       * Separator は align-self: stretch を持っているので、高さを与えると
       * 親の items-center より自分の指定が優先され、帯の上端に貼り付いた
       * 短い線になってしまう（途中で切れているように見える）。
       * 左右の間隔は header の gap-2 に任せる。
       */}
      <Separator orientation="vertical" />
      {activeItem && <h1 className="text-sm font-medium">{activeItem.label}</h1>}
    </header>
  );
}

/**
 * 縦長の画面（スマホ）の上部に出す帯。
 *
 * ここに画面名を出さないのは、いまどの画面かはボトムバーの選択状態が
 * すでに示していて、重ねても分かることが増えないため。
 * 代わりに、ロゴ（Innovators' Club）だけでは何のアプリか分からないので、
 * 稲妻のマークとサービス名を出している。
 *
 * NOTE: 予約の詳細のようにボトムバーに対応するタブが無い画面を作るときは、
 * ここを「← 予約の詳細」のような戻る導線に差し替えること。
 */
export function MobileHeader({ user }: Readonly<{ user: ShellUser }>) {
  const { pathname } = useLocation();
  const activeItem = findActiveNavItem(user.isStaff, pathname);

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 md:hidden">
      <IclubMark className="h-5" />
      <span className="text-sm font-medium">{SERVICE_NAME}</span>

      {/*
       * 画面名は目には出さないが、読み上げでは今どこにいるか分かるようにしておく。
       * PC 用の帯はこの幅では表示されない（＝読み上げの対象にもならない）ので、
       * 見出しが 2 つになることはない。
       */}
      {activeItem && <h1 className="sr-only">{activeItem.label}</h1>}
    </header>
  );
}
