/**
 * iCalendar（RFC 5545）の文字列を組み立てる汎用の道具（ADR-013 決定 5）。
 *
 * 外部ライブラリを足さず、カレンダー配信に必要な最小限の整形処理（CRLF、文字のエスケープ、
 * 75 オクテット折り返し、UTC 時刻のフォーマット）を提供する。
 */

const encoder = new TextEncoder();

/**
 * TEXT 型の値に含まれる特殊文字（\ ; , 改行）をエスケープする。
 *
 * RFC 5545 Section 3.3.11:
 * - \ -> \\
 * - ; -> \;
 * - , -> \,
 * - 改行（CRLF, CR, LF） -> \n
 */
export function escapeIcalText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Date オブジェクトを UTC の時刻文字列（YYYYMMDDTHHMMSSZ）に変換する。
 *
 * カレンダーアプリごとのタイムゾーン定義（VTIMEZONE）の解釈差を避けるため、
 * 時刻はすべて UTC（末尾 Z）で統一する。
 */
export function formatIcalDateTimeUtc(date: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * 1 行の iCal 行を RFC 5545 の 75 オクテット制限に合わせて折り返す。
 *
 * RFC 5545 Section 3.1:
 * 行の長さは改行を除いて 75 オクテット以下にする必要がある。
 * 折り返し行は CRLF の直後に半角空白 1 文字を置く。
 * 日本語などのマルチバイト文字をバイト境界の途中で分断しないよう、
 * コードポイント単位で走査してバイト数を計算する。
 */
export function foldIcalLine(line: string): string {
  const lineBytes = encoder.encode(line);
  if (lineBytes.length <= 75) {
    return line;
  }

  const parts: string[] = [];
  let currentPart = "";
  let currentBytes = 0;

  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    if (currentBytes + charBytes > 75) {
      parts.push(currentPart);
      // 折り返した行は、先頭の半角空白 1 バイトも 75 オクテットに数える
      currentPart = ` ${char}`;
      currentBytes = 1 + charBytes;
    } else {
      currentPart += char;
      currentBytes += charBytes;
    }
  }
  parts.push(currentPart);

  return parts.join("\r\n");
}

/**
 * iCal の行配列を受け取り、行ごとに 75 オクテットで折り返して CRLF で連結した文字列を返す。
 * 末尾にも必ず CRLF を付ける。
 */
export function formatIcalDocument(lines: readonly string[]): string {
  return lines.map(foldIcalLine).join("\r\n") + "\r\n";
}
