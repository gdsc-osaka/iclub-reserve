import aaguids from "./passkey-provider-aaguids.json";

/**
 * パスキーの提供元（Google Password Manager・1Password など）。
 *
 * パスキーには、どの提供元で作られたかを示す機種 ID（AAGUID）が付いている。
 * これを引いて、アカウント設定（SCR-021）の一覧に名前とアイコンを出す（COND-020）。
 */
export interface PasskeyProvider {
  readonly name: string;
  /** 提供元のアイコン。無ければ画面は鍵のアイコンを出す */
  readonly icon: PasskeyProviderIcon | null;
}

/**
 * 提供元のアイコン（SVG の data URI）。明るい背景用と暗い背景用を持つ。
 *
 * 画面は `<img>` で出すので、SVG の中にスクリプトがあっても動かない。
 */
export interface PasskeyProviderIcon {
  readonly light: string;
  readonly dark: string;
}

/** `passkey-provider-aaguids.json` の 1 件分 */
interface AaguidEntry {
  readonly name: string;
  readonly icon_light?: string;
  readonly icon_dark?: string;
}

/**
 * AAGUID から提供元への対応表。
 *
 * 中身は、コミュニティが管理している一覧の `aaguid.json` を、そのまま写したもの。
 * https://github.com/passkeydeveloper/passkey-authenticator-aaguids
 *
 * この一覧は、アカウント設定などでパスキーに名前を付けるためのものとして公開されている。
 * 実行時に取りに行かず写しを持つのは、一覧はいつ無くなってもおかしくないと README に書かれているため。
 * 更新するときは、上の `aaguid.json` を取り直して上書きし、`pnpm format` をかける。
 * 写したのは 2026-09-24（上流のコミット f834526）。
 */
const providers: Readonly<Record<string, AaguidEntry>> = aaguids;

/**
 * 全桁 0 の AAGUID。
 *
 * 提供元を隠す端末（iPhone・Mac の iCloud キーチェーンなど）は、この値を送ってくる。
 */
const ANONYMOUS_AAGUID = "00000000-0000-0000-0000-000000000000";

/** 一覧のアイコンとして受け付ける形。SVG 以外（画像の URL など）が混ざっても出さない */
const SVG_DATA_URI_PREFIX = "data:image/svg+xml;base64,";

const isSvgDataUri = (value: string | undefined): value is string =>
  value?.startsWith(SVG_DATA_URI_PREFIX) ?? false;

/**
 * 明るい背景用と暗い背景用のアイコンをそろえる。
 *
 * 片方しか無ければ、両方にそれを使う。
 */
const toProviderIcon = (entry: AaguidEntry): PasskeyProviderIcon | null => {
  const light = isSvgDataUri(entry.icon_light) ? entry.icon_light : undefined;
  const dark = isSvgDataUri(entry.icon_dark) ? entry.icon_dark : undefined;

  const either = light ?? dark;
  if (either === undefined) return null;
  return { light: light ?? either, dark: dark ?? either };
};

/**
 * AAGUID から提供元を探す。
 *
 * 分からないとき（空・全桁 0・一覧に無い）は null。
 */
export const findPasskeyProvider = (aaguid: string | null | undefined): PasskeyProvider | null => {
  const normalized = aaguid?.trim().toLowerCase();
  if (!normalized || normalized === ANONYMOUS_AAGUID) return null;

  // 一覧にある AAGUID だけを引く。`toString` のような Object の組み込みの名前を拾わないようにする
  if (!Object.hasOwn(providers, normalized)) return null;
  const entry = providers[normalized];

  return { name: entry.name, icon: toProviderIcon(entry) };
};
