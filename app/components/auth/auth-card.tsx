import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

type AuthCardProps = {
  /** カード上部の見出し。 */
  title: string;
  /** 見出しの下に出る説明文。 */
  description: ReactNode;
  /** カードの中身（入力フォームなど）。 */
  children: ReactNode;
  /** カードの下に出る補足（「アカウントをお持ちでない方は…」など）。 */
  footer?: ReactNode;
};

/**
 * ログイン画面・新規登録画面で共通して使うカード型のレイアウト。
 *
 * 画面中央にカードを 1 枚置くだけの構成にして、
 * 各画面はカードの中身（フォーム）だけを書けばよいようにしている。
 */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-4">
        <Card className="[--card-spacing:--spacing(6)]">
          <CardHeader>
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>

        {footer && <div className="text-center text-sm text-muted-foreground">{footer}</div>}
      </div>
    </main>
  );
}
