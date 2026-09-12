import type { CSSProperties } from "react";
import { Link } from "react-router";

import {
  ICLUB_BOLT_BOX,
  ICLUB_WORDMARK_VIEW_BOX,
  IclubWordmark,
} from "~/components/brand/iclub-logo";

/** 開いているときのワードマークの幅（rem）。 */
const WORDMARK_WIDTH = 9;

/** 畳んだときの稲妻の高さ（rem）。ナビの項目のアイコン（1rem）より少し大きくして、ロゴだと分かるようにする。 */
const MARK_HEIGHT = 1.25;

/** SidebarHeader が左右に持っている余白（p-2）の合計。畳んだときに使える幅を出すのに使う。 */
const HEADER_PADDING = 1;

const round = (value: number): number => Number(value.toFixed(4));
const rem = (value: number): string => `${round(value)}rem`;

/**
 * 畳んだときの viewBox 1 単位あたりの長さ。
 *
 * 稲妻を MARK_HEIGHT の高さで見せたいので、稲妻の高さで割った値になる。
 */
const REM_PER_UNIT = MARK_HEIGHT / ICLUB_BOLT_BOX.height;

/*
 * 畳むときの変形。
 *
 * ワードマークを左上を軸に REM_PER_UNIT の比率まで拡大したうえで、
 * 稲妻の左上が枠の左上に来るまでずらす。ずらす量は
 * 「viewBox 内での稲妻の位置 × REM_PER_UNIT」で決まり、
 * 開いているときの幅（WORDMARK_WIDTH）には依存しない。
 *
 * 横方向はさらに、畳んだサイドバーの幅の中央に来るように寄せている。
 * items-center で中央に寄せると、畳み始めた瞬間に中央の位置が確定してしまい、
 * ロゴがその場で飛んでしまうため、位置は最後まで transform だけで決める。
 *
 * 単位に px ではなく rem を使っているのは、文字サイズを大きくしている人の画面でも
 * サイドバーの幅と同じ比率で伸び縮みさせるため。
 */
const collapsedTransform = [
  `translate(`,
  `calc((var(--brand-collapsed-width) - var(--brand-mark-width)) / 2 - ${rem(REM_PER_UNIT * ICLUB_BOLT_BOX.x)}),`,
  `${rem(-REM_PER_UNIT * ICLUB_BOLT_BOX.y)})`,
  ` scale(${round((REM_PER_UNIT * ICLUB_WORDMARK_VIEW_BOX.width) / WORDMARK_WIDTH)})`,
].join("");

const brandStyle = {
  "--brand-wordmark-width": rem(WORDMARK_WIDTH),
  "--brand-wordmark-height": rem(
    (WORDMARK_WIDTH * ICLUB_WORDMARK_VIEW_BOX.height) / ICLUB_WORDMARK_VIEW_BOX.width,
  ),
  "--brand-mark-width": rem(REM_PER_UNIT * ICLUB_BOLT_BOX.width),
  "--brand-mark-height": rem(MARK_HEIGHT),
  "--brand-collapsed-width": `calc(var(--sidebar-width-icon) - ${rem(HEADER_PADDING)})`,
  "--brand-collapsed-transform": collapsedTransform,
} as CSSProperties;

/**
 * サイドバーの先頭に出すロゴとサービス名。
 *
 * ロゴ（Innovators' Club）は団体の名前であってこのシステムの名前ではないので、
 * サービス名を組にして出す。横に並べるとサイドバーの幅（16rem）に収まらないため、
 * ロゴの下に小さく添えている。
 *
 * 畳んだときは稲妻だけが残る。このとき「ワードマークを隠して別のマークを出す」のではなく、
 * ワードマーク 1 枚を拡大してずらし、文字だけを消している。
 * 2 枚を差し替えると、同じ形の稲妻でも位置と大きさが違うぶん、その場で飛んだように見えるため。
 *
 * 動きの長さと緩急（duration-200 / ease-linear）はサイドバー本体の幅の変化に合わせている。
 * ここだけ別の値にすると、ロゴと枠が別々に動いているように見える。
 */
export function BrandHeader() {
  return (
    <Link
      to="/"
      style={brandStyle}
      // 畳む・開くときに幅が変わる。はみ出した分は切り落として、
      // 文字が折り返して一瞬崩れて見えるのを防ぐ
      className="flex flex-col items-start overflow-hidden rounded-md px-2 py-1.5 transition-[padding] duration-200 ease-linear hover:bg-sidebar-accent group-data-[collapsible=icon]:px-0 motion-reduce:transition-none"
    >
      {/* ロゴを収める枠。畳むと稲妻 1 個分の高さまで縮み、はみ出した文字を隠す */}
      <span className="block h-(--brand-wordmark-height) w-(--brand-wordmark-width) overflow-hidden transition-[width,height] duration-200 ease-linear group-data-[collapsible=icon]:h-(--brand-mark-height) group-data-[collapsible=icon]:w-(--brand-collapsed-width) motion-reduce:transition-none">
        <IclubWordmark
          className="w-(--brand-wordmark-width) origin-top-left transition-transform duration-200 ease-linear group-data-[collapsible=icon]:[transform:var(--brand-collapsed-transform)] motion-reduce:transition-none"
          // 文字は動きより先に消す。拡大した文字が枠の下辺で切られるところを見せないため。
          // 開くときは逆に、枠が広がってから出す（delay-75）。
          lettersClassName="transition-opacity delay-75 duration-100 ease-linear group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:delay-0 motion-reduce:transition-none"
        />
      </span>

      {/*
       * サービス名。畳むときは高さごと消す。
       * hidden にすると高さが一気に 0 になってロゴだけが飛ぶので、
       * grid の行の高さ（1fr → 0fr）で滑らかに畳んでいる。
       */}
      <span className="grid grid-rows-[1fr] transition-[grid-template-rows,opacity] duration-200 ease-linear group-data-[collapsible=icon]:grid-rows-[0fr] group-data-[collapsible=icon]:opacity-0 motion-reduce:transition-none">
        <span className="overflow-hidden pt-1.5 text-[11px] leading-tight tracking-wide whitespace-nowrap text-muted-foreground">
          施設・設備 予約システム
        </span>
      </span>
    </Link>
  );
}
