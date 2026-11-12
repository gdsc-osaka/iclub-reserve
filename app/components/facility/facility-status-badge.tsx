import { cn } from "cn";

import { Badge } from "~/components/ui/badge";

/**
 * 施設・設備の状態を利用者向けの日本語にする。
 */
export const facilityStatusLabel = (isActive: boolean): string => (isActive ? "有効" : "無効");

/** 状態ごとの配色 */
const facilityStatusStyle = {
  active: {
    badge: "bg-primary/10 text-primary ring-primary/20",
    dot: "bg-primary",
  },
  inactive: {
    badge: "bg-muted text-muted-foreground ring-foreground/10",
    dot: "bg-muted-foreground",
  },
} as const;

/**
 * 施設・設備の状態（有効・無効）を表示するバッジ。
 */
export function FacilityStatusBadge({
  isActive,
  className,
}: Readonly<{ isActive: boolean; className?: string }>) {
  const style = isActive ? facilityStatusStyle.active : facilityStatusStyle.inactive;

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 border-transparent ring-1 ring-inset", style.badge, className)}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", style.dot)} />
      {facilityStatusLabel(isActive)}
    </Badge>
  );
}
