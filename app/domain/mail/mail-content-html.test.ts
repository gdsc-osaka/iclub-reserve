import { describe, expect, it } from "vite-plus/test";
import { escapeHtml, toMailHtml } from "./mail-content-html";
import type { MailContent } from "./mail-content";

describe("mail-content-html", () => {
  describe("escapeHtml", () => {
    it("&, <, >, \", ' を正しく実体参照にエスケープすること", () => {
      expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
    });
  });

  describe("toMailHtml", () => {
    it("すべての部品で危険な文字が生で出力されずエスケープされること", () => {
      const danger = "<script>alert(1)</script> & \"引用\" 'シングル'";
      const content: MailContent = {
        lead: `リード ${danger}`,
        blocks: [
          { type: "paragraph", text: `段落 ${danger}` },
          {
            type: "details",
            rows: [{ label: `ラベル ${danger}`, value: `値 ${danger}` }],
          },
          {
            type: "notice",
            tone: "default",
            title: `注意見出し ${danger}`,
            text: `注意本文 ${danger}`,
          },
          {
            type: "quote",
            title: `引用元 ${danger}`,
            text: `引用文 ${danger}`,
          },
          {
            type: "code",
            value: `123<script>`,
          },
          {
            type: "action",
            prompt: `案内 ${danger}`,
            label: `ボタン ${danger}`,
            url: `https://example.com/test?a=1&b=2"`,
          },
          {
            type: "footnotes",
            items: [`補足 ${danger}`],
          },
        ],
      };

      const html = toMailHtml(content);

      // 生の <script> タグが一切存在しないこと
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("</script>");
      // エスケープされた文字列が含まれること
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).toContain("&amp;");
      expect(html).toContain("&quot;引用&quot;");
      expect(html).toContain("&#39;シングル&#39;");
      expect(html).toContain("123&lt;script&gt;");
    });

    it("改行が <br> に変換されること", () => {
      const content: MailContent = {
        lead: "リード文です。",
        blocks: [{ type: "paragraph", text: "1行目\n2行目\r\n3行目" }],
      };

      const html = toMailHtml(content);
      expect(html).toContain("1行目<br>2行目<br>3行目");
    });

    it("action の安全な URL が href に正しくエスケープされて設定されること", () => {
      const content: MailContent = {
        lead: "リード文です。",
        blocks: [
          {
            type: "action",
            prompt: "ボタンを押してください。",
            label: "確認する",
            url: "https://example.com/check?param=1&foo=bar",
          },
        ],
      };

      const html = toMailHtml(content);
      expect(html).toContain('<a href="https://example.com/check?param=1&amp;foo=bar"');
      expect(html).toContain("確認する</a>");
    });

    it("javascript: などの安全でない URL では a 要素が出力されず文字として出ること", () => {
      const content: MailContent = {
        lead: "リード文です。",
        blocks: [
          {
            type: "action",
            prompt: "危険なリンクです。",
            label: "押してはいけない",
            url: "javascript:alert(1)",
          },
        ],
      };

      const html = toMailHtml(content);
      // a 要素のタグが出現しないこと
      expect(html).not.toContain("<a ");
      expect(html).not.toContain("<a href");
      // url 自体はエスケープされてテキストとして表示されること
      expect(html).toContain("javascript:alert(1)");
    });

    it("notice の tone が warning のときだけ注意の色が使われること", () => {
      const defaultNotice: MailContent = {
        lead: "通常リード",
        blocks: [
          {
            type: "notice",
            tone: "default",
            text: "通常のお知らせ",
          },
        ],
      };

      const warningNotice: MailContent = {
        lead: "注意リード",
        blocks: [
          {
            type: "notice",
            tone: "warning",
            text: "警告のお知らせ",
          },
        ],
      };

      const defaultHtml = toMailHtml(defaultNotice);
      const warningHtml = toMailHtml(warningNotice);

      // default: border #e5e5e5, bg #ffffff
      expect(defaultHtml).toContain("border: 1px solid #e5e5e5; background-color: #ffffff;");
      expect(defaultHtml).not.toContain("#fce2b6");
      expect(defaultHtml).not.toContain("#fffaf3");

      // warning: border #fce2b6, bg #fffaf3
      expect(warningHtml).toContain("border: 1px solid #fce2b6; background-color: #fffaf3;");
    });
  });
});
