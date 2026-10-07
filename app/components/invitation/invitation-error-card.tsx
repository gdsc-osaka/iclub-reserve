import { isRouteErrorResponse, Link } from "react-router";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

/**
 * 招待の承諾画面（SCR-016 / SCR-020）で共通利用するエラー表示カード。
 *
 * 存在の秘匿に基づき、「存在しない」「期限切れ」「取り消し済み」「宛先違い」を区別せず
 * すべて同じ文言で案内する。
 */
export function InvitationErrorCard({
  error,
}: Readonly<{
  error: unknown;
}>) {
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">
            {isNotFound ? "招待が見つかりません" : "招待を表示できません"}
          </CardTitle>
          <CardDescription>
            {isNotFound
              ? "この招待は期限切れ・取り消し済みか、別のメールアドレス宛ての可能性があります。招待メールの宛先と同じメールアドレスでログインしているか、ご確認ください。"
              : "時間をおいて、もう一度お試しください。"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Link to="/" className="text-sm text-primary underline underline-offset-4">
            ホームへ戻る
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
