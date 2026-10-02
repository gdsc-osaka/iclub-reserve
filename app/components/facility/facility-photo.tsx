import { Wrench } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * 施設・設備の写真。写真が登録されていなければ、代わりのアイコンを出す。
 *
 * 大きさと縦横比は呼び出し側が `className` で決める（例: `aspect-video w-full`）。
 * 枠の大きさを写真に任せないのは、写真を読み込む前後で下の欄が動かないようにするため。
 * 写真の縦横比がまちまちでも、枠いっぱいに切り抜いて（`object-cover`）同じ形で並べる。
 *
 * 写真は縮小せずに原寸のまま配信している（ADR-005 決定 10）。
 * 一覧で何枚も並べる画面では、並べる枚数に気をつけること。
 */
export function FacilityPhoto({
  photoUrl,
  alt,
  className,
}: Readonly<{
  photoUrl: string | null;
  /**
   * 写真の代わりの文字。すぐ隣に施設名を書いているなら空文字にする。
   * 読み上げで同じ名前が 2 回続くのを避けるため。
   */
  alt: string;
  className?: string;
}>) {
  return (
    /*
     * `div` ではなく `span` で組んでいる。ボタンの中（スマホの施設・日時のカード）にも置くため。
     * ボタンの中には `div` を入れられない（HTML の決まり）。
     */
    <span className={cn("relative block overflow-hidden bg-muted", className)}>
      {photoUrl === null ? (
        <span className="flex size-full items-center justify-center text-muted-foreground/60">
          <Wrench aria-hidden className="size-1/3 max-h-12 max-w-12" />
        </span>
      ) : (
        /*
         * `key` を写真ごとに変えて、切り替えたら要素ごと作り直す。
         * 同じ要素の `src` だけを差し替えると、新しい写真を読み終えるまで
         * 前の写真が残り、別の施設の名前と並んで見えてしまう。
         */
        <img
          key={photoUrl}
          src={photoUrl}
          alt={alt}
          decoding="async"
          className="size-full object-cover"
        />
      )}
    </span>
  );
}
