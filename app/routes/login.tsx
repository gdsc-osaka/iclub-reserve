import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

import type { Route } from "./+types/login";

export function meta(_: Route.MetaArgs) {
  return [{ title: "ログイン | iclub-reserve" }];
}

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">ログイン</h1>
          <p className="text-sm text-muted-foreground">
            メールアドレスとパスワードを入力してください
          </p>
        </div>

        <form className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email">メールアドレス</Label>
            <Input id="email" type="email" autoComplete="email" placeholder="example@email.com" />
          </div>

          <div className="space-y-1">
            <Label htmlFor="password">パスワード</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </div>

          <Button type="submit" className="w-full">
            ログイン
          </Button>
        </form>
      </div>
    </div>
  );
}
