import { describe, expect, it } from "vitest";

import { escapeIcalText, foldIcalLine, formatIcalDateTimeUtc, formatIcalDocument } from "./ical";

describe("escapeIcalText", () => {
  it("バックスラッシュ、セミコロン、カンマをエスケープする", () => {
    expect(escapeIcalText("C:\\path;value,next")).toBe("C:\\\\path\\;value\\,next");
  });

  it("CRLF・CR・LF の改行を \\n に正規化してエスケープする", () => {
    expect(escapeIcalText("line1\r\nline2\rline3\nline4")).toBe("line1\\nline2\\nline3\\nline4");
  });

  it("エスケープ対象がない文字列はそのまま返す", () => {
    expect(escapeIcalText("普通のテキスト 123")).toBe("普通のテキスト 123");
  });
});

describe("formatIcalDateTimeUtc", () => {
  it("UTC の YYYYMMDDTHHMMSSZ 形式に変換する（1 桁の月日時は 0 埋め）", () => {
    const date = new Date("2026-04-01T09:05:07.000Z");
    expect(formatIcalDateTimeUtc(date)).toBe("20260401T090507Z");
  });

  it("年末年始やうるう日も正確に UTC で変換する", () => {
    const date = new Date("2024-02-29T23:59:59.000Z");
    expect(formatIcalDateTimeUtc(date)).toBe("20240229T235959Z");
  });
});

describe("foldIcalLine", () => {
  const encoder = new TextEncoder();

  it("75 オクテット以下の行は折り返さない", () => {
    const shortLine = "SUMMARY:Short text";
    expect(foldIcalLine(shortLine)).toBe(shortLine);
  });

  it("ちょうど 75 オクテットの行は折り返さない", () => {
    // ASCII 75 文字 = 75 オクテット
    const exact75 = "A".repeat(75);
    expect(encoder.encode(exact75).length).toBe(75);
    expect(foldIcalLine(exact75)).toBe(exact75);
  });

  it("76 オクテットの ASCII 文字列は 75 文字目と 1 文字目に分割され、先頭に空白が入る", () => {
    const line76 = "A".repeat(76);
    const folded = foldIcalLine(line76);
    expect(folded).toBe(`${"A".repeat(75)}\r\n A`);
  });

  it("日本語の文字（1文字3バイト）の途中で分断せず、各行が 75 オクテット以下になる", () => {
    // "あ" は UTF-8 で 3 バイト。25 文字でちょうど 75 バイト
    const chars25 = "あ".repeat(25);
    expect(encoder.encode(chars25).length).toBe(75);
    expect(foldIcalLine(chars25)).toBe(chars25);

    // 26 文字（78 バイト）の場合、25 文字（75 バイト）で折り返され、次行は半角空白 + "あ"（4 バイト）になる
    const chars26 = "あ".repeat(26);
    const folded = foldIcalLine(chars26);
    expect(folded).toBe(`${"あ".repeat(25)}\r\n あ`);

    // 各行が 75 オクテット以内であることを確認
    const lines = folded.split("\r\n");
    for (const l of lines) {
      expect(encoder.encode(l).length).toBeLessThanOrEqual(75);
    }
  });

  it("長い日本語と記号が混ざった行を折り返し、アンフォールド（CRLF+空白の除去）すると元に戻る", () => {
    const original =
      "DESCRIPTION:使用人数: 12 人\\n備考: 吹田キャンパスのロボット工学実験室にて大型ロボットの組み立てと動作テストを行います。";
    const folded = foldIcalLine(original);

    // 折り返された各行が 75 オクテット以内であることを検証
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) {
      expect(encoder.encode(l).length).toBeLessThanOrEqual(75);
    }

    // RFC 5545 のアンフォールド規則（CRLF + 空白 1 文字の除去）で元通りになること
    const unfolded = folded.replace(/\r\n /g, "");
    expect(unfolded).toBe(original);
  });
});

describe("formatIcalDocument", () => {
  it("各行を折り返して CRLF で結合し、末尾に CRLF を付ける", () => {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "END:VCALENDAR"];
    const doc = formatIcalDocument(lines);
    expect(doc).toBe("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n");
  });
});
