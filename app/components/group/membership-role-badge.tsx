import { MembershipRole, membershipRoleLabel } from "~/domain/membership";
import { cn } from "~/lib/utils";

/** 役割ごとの配色。管理者は primary 系で強調し、一般メンバーは muted 系で控えめにする。 */
const membershipRoleStyle: Record<
  MembershipRole,
  { readonly badge: string; readonly dot: string }
> = {
  [MembershipRole.Admin]: {
    badge: "bg-primary/10 text-primary ring-primary/20",
    dot: "bg-primary",
  },
  [MembershipRole.Member]: {
    badge: "bg-muted text-muted-foreground ring-foreground/10",
    dot: "bg-muted-foreground",
  },
};

/**
 * メンバーの役割をひと目で分かるようにする小さなラベル。
 *
 * COND-007（メンバーロールの単一性）に基づき、各メンバーの役割（admin / member）を表示する。
 */
export function MembershipRoleBadge({
  role,
  className,
}: Readonly<{
  role: MembershipRole;
  className?: string;
}>) {
  const style = membershipRoleStyle[role];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        style.badge,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", style.dot)} />
      {membershipRoleLabel[role]}
    </span>
  );
}
