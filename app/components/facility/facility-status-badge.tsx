import { cn } from "~/lib/utils";

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
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        style.badge,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", style.dot)} />
      {facilityStatusLabel(isActive)}
    </span>
  );
}
