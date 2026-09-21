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
 * COND-007（メンバーロールの単一性）により本来は 1 人 1 役割だが、
 * Better Auth の仕様上 "admin,member" のように複数入ることがあるため、
 * 管理者（admin）が含まれている場合は管理者を優先して 1 つだけ表示する。
 */
export function MembershipRoleBadge({
  roles,
  className,
}: Readonly<{
  roles: readonly MembershipRole[];
  className?: string;
}>) {
  const effectiveRole = roles.includes(MembershipRole.Admin)
    ? MembershipRole.Admin
    : MembershipRole.Member;
  const style = membershipRoleStyle[effectiveRole];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        style.badge,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", style.dot)} />
      {membershipRoleLabel[effectiveRole]}
    </span>
  );
}
