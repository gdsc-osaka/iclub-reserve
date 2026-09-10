import { ChevronsUpDown, LogOut } from "lucide-react";

import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "~/components/ui/sidebar";
import { useSignOut } from "~/lib/auth/use-sign-out";

import { toAvatarInitial, type ShellUser } from "./shell-user";

/**
 * サイドバーのいちばん下に置くアカウントメニュー。
 *
 * ここに入れるのは「自分にだけ関係する設定」に限る。
 * この画面は所属している団体を横断して表示していて「いまどの団体か」が
 * 決まっていないため、団体の設定はここではなく団体の画面側に置く。
 *
 * NOTE: プロフィールの変更・メールアドレスの変更（SCR-017）・
 * パスキーの管理は、画面ができてからここに足す。
 * 今は押しても何も起きない項目を並べないでおく。
 */
export function AccountMenu({ user }: Readonly<{ user: ShellUser }>) {
  const { isMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <UserAvatar user={user} />
              {/* サイドバーを畳んだときは名前とメールを隠し、アバターだけにする */}
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
              <ChevronsUpDown aria-hidden className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            // サイドバーの下端から開くので、PC では上に、スマホでは下に開く
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5">
                <UserAvatar user={user} />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />
            <SignOutMenuItem />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * 名前の 1 文字目を丸で囲んだアイコン。写真は登録できないので文字だけにしている。
 *
 * 角丸の四角にはしないこと。Avatar は縁取りを after 疑似要素の円で描いており、
 * 外側だけを四角にすると、四角の中に円の線が残って二重に見える。
 */
export function UserAvatar({ user }: Readonly<{ user: ShellUser }>) {
  return (
    <Avatar>
      <AvatarFallback>{toAvatarInitial(user.name)}</AvatarFallback>
    </Avatar>
  );
}

/** ログアウトの項目。押している間は二重送信を防ぐため無効にする。 */
function SignOutMenuItem() {
  const { signOut, isSigningOut } = useSignOut();

  return (
    <DropdownMenuItem
      disabled={isSigningOut}
      onSelect={(event) => {
        // メニューを閉じる前にログアウトを走らせたいので、既定の動作を止める
        event.preventDefault();
        void signOut();
      }}
    >
      <LogOut aria-hidden />
      ログアウト
    </DropdownMenuItem>
  );
}
