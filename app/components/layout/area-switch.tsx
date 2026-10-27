import { cn } from "cn";
import { Link } from "react-router";

import { useSidebar } from "~/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

import { type AppArea, type AppAreaLink, toAvailableAreas } from "./app-area";
import { NavCountDot } from "./nav-count";
import { hasAnyNavCount, toNavItems, type NavCounts } from "./nav-items";
import type { ShellUser } from "./shell-user";

/** 切り替えに並べる 1 つの画面 */
interface AreaSwitchItem {
  readonly link: AppAreaLink;
  /** いま開いている画面かどうか */
  readonly isActive: boolean;
  /** その画面のナビに件数があるか（開いている画面には付けない） */
  readonly hasCount: boolean;
}

/** 開いている画面のリンクと、もう一方のリンクの見た目 */
const itemClassName = (isActive: boolean) =>
  isActive
    ? "bg-background font-medium shadow-xs text-foreground"
    : "text-muted-foreground hover:text-foreground";

/**
 * 画面の領域（利用者・事務局）を切り替える部品（ADR-016 決定 5）。
 *
 * 行ける画面が 2 つ以上ある人（事務局スタッフなど）にのみ表示する。
 */
export function AreaSwitch({
  user,
  area,
  counts,
  variant,
}: Readonly<{
  user: Pick<ShellUser, "isStaff">;
  area: AppArea;
  counts: NavCounts;
  variant: "sidebar" | "header";
}>) {
  const availableAreas = toAvailableAreas(user);
  if (availableAreas.length < 2) return null;

  const items = availableAreas.map((link): AreaSwitchItem => {
    const isActive = link.area === area;
    return {
      link,
      isActive,
      hasCount: !isActive && hasAnyNavCount(counts, toNavItems(link.area)),
    };
  });

  return variant === "header" ? (
    <HeaderAreaSwitch items={items} />
  ) : (
    <SidebarAreaSwitch items={items} />
  );
}

/** サイドバーの上部に置く切り替え */
function SidebarAreaSwitch({ items }: Readonly<{ items: readonly AreaSwitchItem[] }>) {
  return (
    <nav
      aria-label="表示する画面"
      className="grid grid-cols-2 gap-0.5 rounded-md bg-muted p-0.5 group-data-[collapsible=icon]:grid-cols-1"
    >
      {items.map((item) => (
        <SidebarAreaSwitchItem key={item.link.area} item={item} />
      ))}
    </nav>
  );
}

/**
 * サイドバー内の 1 項目。
 *
 * 畳んだときは文字を隠すので、`SidebarMenuButton` と同じく、そのときだけツールチップで名前を出す。
 */
function SidebarAreaSwitchItem({ item }: Readonly<{ item: AreaSwitchItem }>) {
  const { isMobile, state } = useSidebar();
  const { link, isActive, hasCount } = item;
  const Icon = link.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={link.to}
          aria-current={isActive ? "true" : undefined}
          className={cn(
            "relative flex h-8 items-center justify-center gap-1.5 rounded-sm px-2 text-xs transition-colors group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0",
            itemClassName(isActive),
          )}
        >
          <Icon aria-hidden className="size-4 shrink-0" />
          <span className="truncate group-data-[collapsible=icon]:sr-only">{link.label}</span>
          {hasCount && (
            <AreaCountMark className="top-1.5 right-1.5 group-data-[collapsible=icon]:top-1 group-data-[collapsible=icon]:right-1" />
          )}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" align="center" hidden={state !== "collapsed" || isMobile}>
        {link.label}
      </TooltipContent>
    </Tooltip>
  );
}

/** スマホの上部の帯に置く切り替え。幅が狭いので文字だけにする */
function HeaderAreaSwitch({ items }: Readonly<{ items: readonly AreaSwitchItem[] }>) {
  return (
    <nav aria-label="表示する画面" className="flex items-center rounded-md bg-muted p-0.5">
      {items.map(({ link, isActive, hasCount }) => (
        <Link
          key={link.area}
          to={link.to}
          aria-current={isActive ? "true" : undefined}
          className={cn(
            "relative flex h-8 items-center justify-center rounded-sm px-2.5 text-xs transition-colors",
            itemClassName(isActive),
          )}
        >
          {link.label}
          {hasCount && <AreaCountMark className="top-1.5 right-1" />}
        </Link>
      ))}
    </nav>
  );
}

/**
 * もう一方の画面に件数があることを示す点と、その読み上げ（ADR-016 決定 5）。
 *
 * 数字にしないのは、ボトムバーの「その他」と同じく、種類の違う件数を足しても意味が無いため。
 */
function AreaCountMark({ className }: Readonly<{ className: string }>) {
  return (
    <>
      <NavCountDot className={cn("absolute", className)} />
      <span className="sr-only">（件数のある項目があります）</span>
    </>
  );
}
