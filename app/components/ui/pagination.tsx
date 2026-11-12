import * as React from "react";
import { cn } from "cn";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";

/*
 * shadcn/ui の pagination をこのアプリ向けに手直ししたもの（shadcn add --overwrite で戻さないこと）。
 * - リンクは React Router の Link にする。<a> のままだと、ページを送るたびに画面ごと読み込み直す
 * - 既定の文言を日本語にする
 * - 前へ・次へは、狭い画面でも文字を隠さず、aria-label も付けない。矢印だけでは
 *   どちらへ送るのか（新しい履歴か古い履歴か）が分からないため、見えている文字をそのまま名前にする
 */

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="ページ送り"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  );
}

function PaginationContent({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex items-center gap-0.5", className)}
      {...props}
    />
  );
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />;
}

type PaginationLinkProps = {
  isActive?: boolean;
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  React.ComponentProps<typeof Link>;

function PaginationLink({ className, isActive, size = "icon", ...props }: PaginationLinkProps) {
  return (
    <Button asChild variant={isActive ? "outline" : "ghost"} size={size} className={cn(className)}>
      <Link
        aria-current={isActive ? "page" : undefined}
        data-slot="pagination-link"
        data-active={isActive}
        {...props}
      />
    </Button>
  );
}

function PaginationPrevious({
  className,
  text = "前へ",
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
  return (
    <PaginationLink size="default" className={cn("ps-1.5!", className)} {...props}>
      <ChevronLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
      <span>{text}</span>
    </PaginationLink>
  );
}

function PaginationNext({
  className,
  text = "次へ",
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
  return (
    <PaginationLink size="default" className={cn("pe-1.5!", className)} {...props}>
      <span>{text}</span>
      <ChevronRightIcon data-icon="inline-end" className="rtl:rotate-180" />
    </PaginationLink>
  );
}

function PaginationEllipsis({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn(
        "flex size-8 items-center justify-center [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <MoreHorizontalIcon />
      <span className="sr-only">ほかのページ</span>
    </span>
  );
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
};
