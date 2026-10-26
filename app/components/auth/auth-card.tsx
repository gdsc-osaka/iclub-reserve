import type { ReactNode } from "react";

import { IclubWordmark } from "~/components/brand/iclub-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

/*
 * 背景の写真。i-Club の活動スペース（共創 C 棟 2F）。
 *
 * i-Club のサイトの記事（https://ou-iclub.net/news/2519/）に載っている写真のうち、
 * 室内の部分を切り抜いたもの。元の写真は Adobe RGB で保存されているので、
 * sRGB に変換してから WebP にしている（変換せずに色の情報を外すと色がずれる）。
 * 差し替えるときも、同じように sRGB にしてから書き出すこと。
 */
import spacePhoto from "./iclub-space.webp";

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
 * 施設の写真を全画面に敷き、その上に i-Club のロゴとカードを 1 枚置く。
 * 各画面はカードの中身（フォーム）だけを書けばよいようにしている。
 *
 * ログインから初回設定・パスキーの案内までは一続きの手続きなので、
 * どの画面もこのレイアウトを使い、途中で見た目が切り替わらないようにしている。
 */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    // 写真が読み込まれるまでは暗い下地を見せる。白い画面から写真に切り替わって光らないように
    <main className="relative isolate flex min-h-svh items-center justify-center bg-neutral-900 px-4 py-10">
      <AuthBackground />

      <div className="w-full max-w-sm space-y-8">
        <AuthBrand />

        <div className="space-y-4">
          {/*
           * カードは透けさせない。写真の上でも文字を読みやすくするためと、
           * ログイン方法の間の「または」が、カードと同じ色の下地で区切り線を隠しているため。
           */}
          <Card className="shadow-xl [--card-spacing:--spacing(6)]">
            <CardHeader>
              <CardTitle className="text-xl">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>{children}</CardContent>
          </Card>

          {footer && <div className="text-center text-sm text-white/80">{footer}</div>}
        </div>
      </div>
    </main>
  );
}

/**
 * 背景の写真と、その上に重ねる暗い膜。
 *
 * 写真は解像度が高くないので、大きな画面では引き伸ばされてぼやける。
 * 軽くぼかして、ぼやけを狙ったものに見せている。ぼかすと縁が透けて下地の色がにじむので、
 * 少し拡大して縁を画面の外に出し、はみ出した分は外側の枠で切り落としている。
 *
 * fixed にしているのは、カードが画面より長くなってスクロールしたときも、
 * 写真が画面全体を覆ったままにするため。
 */
function AuthBackground() {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden">
      <img
        src={spacePhoto}
        alt=""
        decoding="async"
        className="size-full scale-105 object-cover blur-xs"
      />
      {/* ダークテーマではカードも暗いので、膜を濃くして写真とカードの差を保つ */}
      <div className="absolute inset-0 bg-black/50 dark:bg-black/65" />
    </div>
  );
}

/**
 * カードの上に出すロゴとサービス名。
 *
 * 暗い膜の上に出すので、テーマに関係なく文字を白にする（ロゴの文字は currentColor を継ぐ）。
 * 稲妻は指定色の黄色のまま。施設の看板も、黒地に白い文字と黄色の稲妻の組み合わせになっている。
 *
 * ロゴ（Innovators' Club）は団体の名前であってこのシステムの名前ではないので、
 * サイドバーの BrandHeader と同じく、サービス名を組にして出す。
 */
function AuthBrand() {
  return (
    <div className="flex flex-col items-center gap-3 text-white">
      <IclubWordmark className="w-72 max-w-full" />
      <p className="text-sm tracking-wide text-white/80">施設・設備 予約システム</p>
    </div>
  );
}
