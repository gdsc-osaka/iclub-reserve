import { getAuthenticatorName } from "@better-auth/passkey";

/**
 * User-Agent 文字列から OS を判定する。
 *
 * 判定の順序:
 * 1. iPhone / iPad
 * 2. Android（Linux の文字列を含むため Linux より先に判定する）
 * 3. Windows
 * 4. ChromeOS（Linux の文字列を含むことがあるため先に判定する）
 * 5. Mac（iPadOS 13 以降の Safari はデスクトップ版 Mac と同じ UA を送るため「Mac」と判定される。これは仕様として受け入れる）
 * 6. Linux
 */
const detectOs = (ua: string): string | undefined => {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows|Win32|Win64|WOW64/i.test(ua)) return "Windows";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  // iPadOS 13 以降の Safari は Mac と同じ UA を送るため「Mac」になる（COND-020 仕様）
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Linux";
  return undefined;
};

/**
 * User-Agent 文字列からブラウザを判定する。
 *
 * 判定の順序:
 * 1. Edge（UA に Chrome と Safari を含むため先頭で判定する）
 * 2. Opera（UA に Chrome と Safari を含むため先頭で判定する。iOS 版は OPT・Opera Mini は OPiOS）
 * 3. Samsung Internet（UA に Chrome と Safari を含むため Chrome より先に判定する）
 * 4. Firefox（iOS 版の FxiOS は Safari を含むため Safari より先に判定する）
 * 5. Chrome（iOS 版の CriOS は Safari を含むため Safari より先に判定する）
 * 6. Safari（他の WebKit 系ブラウザを除いたあとに残る Safari）
 */
const detectBrowser = (ua: string): string | undefined => {
  if (/(?:Edg|Edge|EdgiOS)\//i.test(ua)) return "Edge";
  // OPT は短いので、ほかの語の一部（例: Adopt/）に当たらないよう語の頭に限る
  if (/\b(?:OPR|Opera|OPiOS|OPT)\//i.test(ua)) return "Opera";
  if (/SamsungBrowser\//i.test(ua)) return "Samsung Internet";
  if (/(?:Firefox|FxiOS)\//i.test(ua)) return "Firefox";
  if (/(?:Chrome|CriOS)\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua)) return "Safari";
  return undefined;
};

/**
 * User-Agent から端末の表示名を組み立てる（COND-020）。
 *
 * 組み立てパターン:
 * - OS とブラウザの両方が判明: 「Windows の Chrome」
 * - OS だけ判明: 「Windows のブラウザ」
 * - ブラウザだけ判明: 「Chrome」
 * - どちらも不明（null、空文字、解釈不能な文字列）: 「不明な端末」
 */
export const toDeviceName = (userAgent: string | null | undefined): string => {
  if (!userAgent || userAgent.trim() === "") {
    return "不明な端末";
  }

  const os = detectOs(userAgent);
  const browser = detectBrowser(userAgent);

  if (os && browser) {
    return `${os} の ${browser}`;
  }
  if (os && !browser) {
    return `${os} のブラウザ`;
  }
  if (!os && browser) {
    return browser;
  }
  return "不明な端末";
};

/**
 * パスキー登録時にサーバー側で付ける名前を決める（COND-020）。
 *
 * 1. 認証器の機種 ID（AAGUID）から提供元（Google Password Manager 等）が分かればその名前。
 * 2. 分からなければ（Apple 端末など 0 埋めの AAGUID を含む）、登録時の User-Agent から端末名を組み立てる。
 */
export const toPasskeyName = ({
  aaguid,
  userAgent,
}: {
  readonly aaguid?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
}): string => {
  const authenticatorName = getAuthenticatorName(aaguid);
  if (authenticatorName) {
    return authenticatorName;
  }
  return toDeviceName(userAgent);
};

/**
 * 一覧に表示するパスキーの名前を決める（COND-020）。
 *
 * 1. 保存された名前（`name`）があればそれを使う。
 * 2. 名前が無ければ AAGUID から提供元を探す。
 * 3. それも無ければ「パスキー」とする。
 */
export const toPasskeyLabel = ({
  name,
  aaguid,
}: {
  readonly name?: string | null | undefined;
  readonly aaguid?: string | null | undefined;
}): string => {
  if (name && name.trim() !== "") {
    return name;
  }
  const authenticatorName = getAuthenticatorName(aaguid);
  if (authenticatorName) {
    return authenticatorName;
  }
  return "パスキー";
};
