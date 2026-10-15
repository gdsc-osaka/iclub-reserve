/**
 * ホーム画面・ブラウザのタブに出すアイコンを、i-Club のロゴの稲妻から作る。
 *
 * 動かし方: `pnpm run icons:generate`
 *
 * 作った画像は public/ に書き出し、リポジトリに含める（ビルドのたびには作らない）。
 * 稲妻の形・色（app/components/brand/iclub-bolt.ts）や、下の背景色・大きさを
 * 変えたときだけ動かし直せばよい。どの画像をどこで使うかは ADR-011 を参照。
 *
 * SVG を PNG にするのに、E2E で使っている Playwright の Chromium を借りる。
 * 画像の変換のためだけに依存を増やさないため。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import {
  ICLUB_BOLT_BOX,
  ICLUB_BOLT_COLOR,
  ICLUB_BOLT_PATH,
} from "../app/components/brand/iclub-bolt.js";

/** 書き出し先。ここに置いたファイルは、ログインしていなくても配信される。 */
const PUBLIC_DIR = "public";

/**
 * 稲妻の後ろに敷く色。
 *
 * ロゴの文字と同じ黒にして、黄色の稲妻がいちばん目立つようにしている。
 * 白では黄色との差が小さく、ホーム画面でもタブでも稲妻が読みにくい。
 */
const BACKGROUND_COLOR = "#171717";

/**
 * 1 色のアイコン（MONOCHROME）で稲妻を塗る色。
 * 使う側は色を捨てて形だけを使うので、何色でもよい。黒にしておくと、画像を開いたときに形が見える。
 */
const MONOCHROME_COLOR = "#000000";

type IconShape = {
  /** 一辺の長さ（px） */
  size: number;
  /** 一辺に対する、稲妻の高さの割合 */
  boltScale: number;
  /** 一辺に対する、角の丸みの半径の割合。0 なら四角いまま塗りつぶす */
  cornerRadius: number;
  /** true なら背景を敷かず、稲妻だけを 1 色で描く */
  monochrome?: boolean;
};

/**
 * ホーム画面やインストールしたアプリの窓に出すアイコン（manifest の purpose: "any"）。
 * OS がそのまま出すので、角を自分で丸めておく。
 */
const ANY: Omit<IconShape, "size"> = { boltScale: 0.6, cornerRadius: 0.22 };

/**
 * Android が丸や角丸に切り抜いて出すアイコン（manifest の purpose: "maskable"）。
 *
 * 切り抜かれても欠けないのは、中心から一辺の 40% の円の中だけ。
 * 稲妻の外接矩形の対角の半分が一辺の約 33% になるよう、稲妻を小さめにしている。
 * 四隅まで塗りつぶすのは、切り抜いた形の外に透明な部分を残さないため。
 */
const MASKABLE: Omit<IconShape, "size"> = { boltScale: 0.55, cornerRadius: 0 };

/**
 * 1 色で塗り直して使うアイコン（manifest の purpose: "monochrome"）。
 *
 * 使う側は色を捨て、透明かどうか（アルファ）だけを型抜きに使う。そのため背景は敷かず、稲妻だけを描く。
 * Android のテーマアイコンのように、切り抜いた形の中に置かれることを考えて、大きさは MASKABLE にそろえる。
 *
 * NOTE: 2026-10 時点の Android の Chrome は、インストールしたアプリのアイコンにこれを使わない（ADR-011）。
 */
const MONOCHROME: Omit<IconShape, "size"> = {
  boltScale: 0.55,
  cornerRadius: 0,
  monochrome: true,
};

/**
 * iPhone・iPad のホーム画面に出すアイコン（apple-touch-icon）。
 * iOS が自分で角を丸めるので四隅まで塗る。透明にすると、その部分が黒く塗られる。
 */
const APPLE_TOUCH: Omit<IconShape, "size"> = { boltScale: 0.6, cornerRadius: 0 };

/**
 * ブラウザのタブに出すアイコン（favicon.ico）。
 * 16px でも稲妻だと分かるよう、ホーム画面のものより稲妻を大きくする。
 */
const FAVICON: Omit<IconShape, "size"> = { boltScale: 0.75, cornerRadius: 0.22 };

/** public/ からのパスと、作るアイコンの形。 */
const PNG_ICONS: readonly { file: string; shape: IconShape }[] = [
  { file: "icons/icon-192.png", shape: { ...ANY, size: 192 } },
  { file: "icons/icon-512.png", shape: { ...ANY, size: 512 } },
  { file: "icons/maskable-512.png", shape: { ...MASKABLE, size: 512 } },
  { file: "icons/monochrome-512.png", shape: { ...MONOCHROME, size: 512 } },
  { file: "apple-touch-icon.png", shape: { ...APPLE_TOUCH, size: 180 } },
];

/** favicon.ico に詰める大きさ。Windows のタスクバーなどが 16・32・48 を使い分ける。 */
const FAVICON_SIZES = [16, 32, 48] as const;

/** 背景の上に、稲妻を真ん中に置いた SVG を組み立てる。 */
const toIconSvg = ({ size, boltScale, cornerRadius, monochrome = false }: IconShape): string => {
  const boltHeight = size * boltScale;
  const boltWidth = (boltHeight * ICLUB_BOLT_BOX.width) / ICLUB_BOLT_BOX.height;
  const boltViewBox = [
    ICLUB_BOLT_BOX.x,
    ICLUB_BOLT_BOX.y,
    ICLUB_BOLT_BOX.width,
    ICLUB_BOLT_BOX.height,
  ].join(" ");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    monochrome
      ? ""
      : `<rect width="${size}" height="${size}" rx="${size * cornerRadius}" fill="${BACKGROUND_COLOR}" />`,
    `<svg x="${(size - boltWidth) / 2}" y="${(size - boltHeight) / 2}" width="${boltWidth}" height="${boltHeight}" viewBox="${boltViewBox}">`,
    `<path fill="${monochrome ? MONOCHROME_COLOR : ICLUB_BOLT_COLOR}" d="${ICLUB_BOLT_PATH}" />`,
    "</svg>",
    "</svg>",
  ].join("");
};

/** SVG をブラウザに描かせて、背景を透明にした PNG にする。 */
const renderPng = async (page: Page, shape: IconShape): Promise<Buffer> => {
  await page.setContent(`<!doctype html><body style="margin:0">${toIconSvg(shape)}</body>`);
  return page.screenshot({
    clip: { x: 0, y: 0, width: shape.size, height: shape.size },
    omitBackground: true,
  });
};

/**
 * PNG をそのまま詰めた .ico を組み立てる。
 *
 * .ico は「6 バイトの見出し」「画像ごとに 16 バイトの目録」「画像の中身」を並べたもの。
 * 中身に PNG をそのまま入れる形は、今のブラウザと Windows ならどれでも読める。
 */
const toIco = (images: readonly { size: number; png: Buffer }[]): Buffer => {
  const HEADER_BYTES = 6;
  const ENTRY_BYTES = 16;

  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt16LE(0, 0); // 予約領域（常に 0）
  header.writeUInt16LE(1, 2); // 1 = アイコン
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(ENTRY_BYTES * images.length);
  let offset = HEADER_BYTES + ENTRY_BYTES * images.length;
  images.forEach(({ size, png }, index) => {
    const at = ENTRY_BYTES * index;
    entries.writeUInt8(size, at); // 幅
    entries.writeUInt8(size, at + 1); // 高さ
    entries.writeUInt8(0, at + 2); // パレットの色数（使わない）
    entries.writeUInt8(0, at + 3); // 予約領域
    entries.writeUInt16LE(1, at + 4); // カラープレーン数
    entries.writeUInt16LE(32, at + 6); // 1 画素のビット数
    entries.writeUInt32LE(png.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, entries, ...images.map(({ png }) => png)]);
};

const main = async () => {
  const browser = await chromium.launch();
  try {
    // 一番大きいアイコンが収まる画面で描き、左上から切り出す
    const page = await browser.newPage({
      viewport: { width: 512, height: 512 },
      deviceScaleFactor: 1,
    });

    for (const { file, shape } of PNG_ICONS) {
      const target = path.join(PUBLIC_DIR, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await renderPng(page, shape));
      console.info(`wrote ${target}`);
    }

    const faviconImages = [];
    for (const size of FAVICON_SIZES) {
      faviconImages.push({ size, png: await renderPng(page, { ...FAVICON, size }) });
    }
    const faviconTarget = path.join(PUBLIC_DIR, "favicon.ico");
    await writeFile(faviconTarget, toIco(faviconImages));
    console.info(`wrote ${faviconTarget}`);
  } finally {
    await browser.close();
  }
};

await main();
