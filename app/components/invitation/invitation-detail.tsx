import type { ReactNode } from "react";

/**
 * 招待内容の枠内に表示する 1 項目（見出しと値）。
 */
export function InvitationDetail({
  label,
  children,
}: Readonly<{
  label: string;
  children: ReactNode;
}>) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
