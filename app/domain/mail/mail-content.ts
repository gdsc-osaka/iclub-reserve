/** メール 1 通の中身。テキスト版と HTML 版を、この同じ中身から作る */
export interface MailContent {
  /** 用件を伝える最初の 1 文（句点まで）。HTML では見出しとして大きく出す */
  readonly lead: string;
  /** lead の下に、上から順に並べる部品 */
  readonly blocks: readonly MailBlock[];
}

export type MailBlock =
  /** 説明の文。改行（\n）を含めてよい */
  | { readonly type: "paragraph"; readonly text: string }
  /** 「ラベル: 値」の並び */
  | { readonly type: "details"; readonly rows: readonly MailDetailRow[] }
  /** 枠で囲んで目立たせる案内。tone が warning なら注意の色にする */
  | {
      readonly type: "notice";
      readonly tone: "default" | "warning";
      readonly title?: string;
      readonly text: string;
    }
  /** 利用者が書いた文の引用（メッセージ本文） */
  | { readonly type: "quote"; readonly title: string; readonly text: string }
  /** 認証コード */
  | { readonly type: "code"; readonly value: string }
  /** 開いてほしいページ。prompt は案内の文、label は HTML のボタンの文字 */
  | {
      readonly type: "action";
      readonly prompt: string;
      readonly label: string;
      readonly url: string;
    }
  /** 補足。1 件ずつ「※ 」を付けて出す */
  | { readonly type: "footnotes"; readonly items: readonly string[] };

export interface MailDetailRow {
  readonly label: string;
  readonly value: string;
}

/** 全メール共通の冒頭のあいさつ文 */
export const MAIL_GREETING = "i-Club 予約システムをご利用いただきありがとうございます。";

/** 全メール共通の署名の組織・システム名 */
export const MAIL_SIGNATURE_NAME = "大阪大学 Innovators' Club (i-Club) 予約システム";

/** 全メール共通の署名の注意書き */
export const MAIL_SIGNATURE_NOTE = "※このメールは送信専用です。返信はできません。";

/** テキスト版の署名の区切り線 */
export const MAIL_SIGNATURE_DIVIDER = "----------------------------------------";

const renderBlockText = (block: MailBlock): string => {
  switch (block.type) {
    case "paragraph":
      return block.text;
    case "details":
      return block.rows.map((row) => `${row.label}: ${row.value}`).join("\n");
    case "notice":
      return block.title ? `${block.title}: ${block.text}` : block.text;
    case "quote":
      return `${block.title}:\n${block.text}`;
    case "code":
      return `    ${block.value}`;
    case "action":
      return `${block.prompt}\n${block.url}`;
    case "footnotes":
      return block.items.map((item) => `※ ${item}`).join("\n");
    default: {
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
};

/**
 * MailContent からプレーンテキスト版のメール本文を組み立てる純粋関数。
 */
export const toMailText = (content: MailContent): string => {
  const renderedBlocks = content.blocks.map(renderBlockText);
  const signature = [MAIL_SIGNATURE_DIVIDER, MAIL_SIGNATURE_NAME, MAIL_SIGNATURE_NOTE].join("\n");
  const sections = [MAIL_GREETING, content.lead, ...renderedBlocks, signature];

  return sections.join("\n\n");
};
