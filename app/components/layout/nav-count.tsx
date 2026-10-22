import { cn } from "cn";

import { formatNavCount } from "./nav-items";

/*
 * ナビ項目に添える件数の部品（#189）。サイドバー・ボトムバー・「その他」のシートで使う。
 *
 * 見た目の数字や点は読み上げない（aria-hidden）。代わりに NavCountText をリンクの中に置き、
 * リンクの名前を「予約の承認（3 件）」にする。数字だけを読み上げると、
 * 何の数なのかが分からないうえ、99+ のときに実際の件数が伝わらない。
 */

/** 読み上げ用の「（3 件）」。画面には出さない */
export function NavCountText({ count }: Readonly<{ count: number }>) {
  return <span className="sr-only">（{count} 件）</span>;
}

/** 件数の数字を丸で囲んだ印 */
export function NavCountBadge({
  count,
  className,
}: Readonly<{ count: number; className?: string }>) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums",
        className,
      )}
    >
      {formatNavCount(count)}
    </span>
  );
}

/**
 * 数字を出す場所が無いときの、小さな点の印。
 *
 * 位置は呼び出し側が決める（アイコンの右上に重ねる）。
 */
export function NavCountDot({ className }: Readonly<{ className?: string }>) {
  return <span aria-hidden className={cn("size-1.5 rounded-full bg-primary", className)} />;
}
