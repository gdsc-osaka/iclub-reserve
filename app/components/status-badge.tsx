import { cn } from "~/lib/utils";

/**
 * 状態を表す色の種類。
 *
 * 「承認済み」「却下済み」といった個々の状態名ではなく、
 * 利用者にとっての意味合い (順調・待ち・問題あり・終了) で分けている。
 * 団体でも予約でも同じ色づかいになるので、画面をまたいでも読み方が変わらない。
 */
export const StatusTone = {
  /** 順調に進んでいる (有効・承認済み) */
  Positive: "positive",
  /** 相手の対応を待っている (承認待ち) */
  Attention: "attention",
  /** 望まない結果で終わった (却下・事務局キャンセル) */
  Danger: "danger",
  /** 役目を終えた (停止中・取り消し済み) */
  Neutral: "neutral",
} as const;
export type StatusTone = (typeof StatusTone)[keyof typeof StatusTone];

const toneStyle: Record<StatusTone, { readonly badge: string; readonly dot: string }> = {
  [StatusTone.Positive]: {
    // ダークテーマの --primary は暗い青緑で、そのまま文字色にすると読みづらい。
    // 同じ色相の明るい色に置き換えて、暗い背景でも文字が浮くようにしている
    badge: "bg-primary/10 text-primary ring-primary/20 dark:text-teal-300",
    dot: "bg-primary dark:bg-teal-300",
  },
  [StatusTone.Attention]: {
    badge: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  [StatusTone.Danger]: {
    badge: "bg-destructive/10 text-destructive ring-destructive/20",
    dot: "bg-destructive",
  },
  [StatusTone.Neutral]: {
    badge: "bg-muted text-muted-foreground ring-foreground/10",
    dot: "bg-muted-foreground",
  },
};

/**
 * 状態をひと目で分かるようにする小さなラベル。
 *
 * 色だけで意味を伝えると、色が見分けづらい人に届かない。
 * そのため必ず日本語のラベルを併記し、色は補助に留めている。
 */
export function StatusBadge({
  tone,
  label,
  className,
}: Readonly<{ tone: StatusTone; label: string; className?: string }>) {
  const style = toneStyle[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        style.badge,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", style.dot)} />
      {label}
    </span>
  );
}
