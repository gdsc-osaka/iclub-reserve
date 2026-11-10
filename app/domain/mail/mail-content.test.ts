import { describe, expect, it } from "vite-plus/test";
import {
  MAIL_GREETING,
  MAIL_SIGNATURE_DIVIDER,
  MAIL_SIGNATURE_NAME,
  MAIL_SIGNATURE_NOTE,
  toMailText,
  type MailContent,
} from "./mail-content";

describe("mail-content", () => {
  describe("toMailText", () => {
    it("挨拶・lead・全種類の部品・署名が正しい空行区切りでレンダリングされること", () => {
      const content: MailContent = {
        lead: "テストのリード文です。",
        blocks: [
          { type: "paragraph", text: "段落の本文です。\n2行目です。" },
          {
            type: "details",
            rows: [
              { label: "項目1", value: "値1" },
              { label: "項目2", value: "値2" },
            ],
          },
          {
            type: "notice",
            tone: "default",
            title: "案内見出し",
            text: "案内の本文です。",
          },
          {
            type: "notice",
            tone: "warning",
            text: "タイトルなしの警告案内です。",
          },
          {
            type: "quote",
            title: "引用元",
            text: "引用の本文です。",
          },
          {
            type: "code",
            value: "123456",
          },
          {
            type: "action",
            prompt: "詳細はこちらからご確認ください。",
            label: "詳細を開く",
            url: "https://example.com/details",
          },
          {
            type: "footnotes",
            items: ["補足事項1", "補足事項2"],
          },
        ],
      };

      const expected = [
        MAIL_GREETING,
        "",
        "テストのリード文です。",
        "",
        "段落の本文です。\n2行目です。",
        "",
        "項目1: 値1\n項目2: 値2",
        "",
        "案内見出し: 案内の本文です。",
        "",
        "タイトルなしの警告案内です。",
        "",
        "引用元:\n引用の本文です。",
        "",
        "    123456",
        "",
        "詳細はこちらからご確認ください。\nhttps://example.com/details",
        "",
        "※ 補足事項1\n※ 補足事項2",
        "",
        MAIL_SIGNATURE_DIVIDER,
        MAIL_SIGNATURE_NAME,
        MAIL_SIGNATURE_NOTE,
      ].join("\n");

      expect(toMailText(content)).toBe(expected);
    });

    it("blocks が空の場合でも挨拶・lead・署名が出力されること", () => {
      const content: MailContent = {
        lead: "ブロック無しのリード文です。",
        blocks: [],
      };

      const expected = [
        MAIL_GREETING,
        "",
        "ブロック無しのリード文です。",
        "",
        MAIL_SIGNATURE_DIVIDER,
        MAIL_SIGNATURE_NAME,
        MAIL_SIGNATURE_NOTE,
      ].join("\n");

      expect(toMailText(content)).toBe(expected);
    });
  });
});
