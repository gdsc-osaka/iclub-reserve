import type { MailBlock, MailContent } from "./mail-content";
import { MAIL_SIGNATURE_NAME, MAIL_SIGNATURE_NOTE } from "./mail-content";

/*
 * メールの HTML 版（ADR-018）。
 *
 * メールソフトは、画面で使っている書き方の多くを読めない（CSS 変数・oklch・flex・grid・
 * Web フォント・<style> 要素）。そのため、色は 16 進で、見た目はすべて style 属性で、
 * 配置は table で書く。余白は div ではなく td に付ける（Outlook は div の padding を読まない）。
 */

// 色。画面（app/app.css）のどの色に当たるかを添える
/** 主色（ヘッダーの文字・ボタンの地）: --primary */
const COLOR_PRIMARY = "#0f766e";
/** ボタンの文字: --primary-foreground に近い白 */
const COLOR_PRIMARY_FOREGROUND = "#ffffff";
/** 本文の文字: --foreground */
const COLOR_FOREGROUND = "#0a0a0a";
/** 控えめな文字（ラベル・補足・フッター）: --muted-foreground */
const COLOR_MUTED_FOREGROUND = "#737373";
/** 外側の地: --muted */
const COLOR_MUTED_BACKGROUND = "#f5f5f5";
/** カードの地: --card */
const COLOR_CARD_BACKGROUND = "#ffffff";
/** 枠線: --border */
const COLOR_BORDER = "#e5e5e5";
/** 注意の枠線: 予約詳細の「解錠の手配」の border-amber-500/30 */
const COLOR_WARNING_BORDER = "#fce2b6";
/** 注意の地: 同じく bg-amber-500/5 */
const COLOR_WARNING_BACKGROUND = "#fffaf3";

/** 画面の Inter は読み込めないので、端末に入っている書体に任せる */
const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', Meiryo, sans-serif";
const CODE_FONT_FAMILY = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

/** 本文の文字の指定。table の中へ書体を引き継がないメールソフトがあるので、td ごとに付ける */
const TEXT_STYLE = `font-family: ${FONT_FAMILY}; font-size: 14px; line-height: 1.7; color: ${COLOR_FOREGROUND};`;
/** 控えめな小さい文字の指定 */
const SMALL_TEXT_STYLE = `font-family: ${FONT_FAMILY}; font-size: 12px; line-height: 1.5; color: ${COLOR_MUTED_FOREGROUND};`;

const TABLE_ATTRIBUTES = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

/**
 * HTML の記号を実体参照に変える。
 *
 * メールに載せる文字列（利用者が入力した理由・メッセージ・団体名・氏名を含む）は、
 * 例外なくここを通してから埋め込む。
 */
export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** エスケープしたうえで、改行を <br> にする（white-space: pre-wrap は効かないメールソフトがある） */
const formatHtmlText = (text: string): string => escapeHtml(text).replace(/\r\n|\n/g, "<br>");

/** ボタンのリンク先にしてよい URL か。javascript: などを href に入れないために確かめる */
const isSafeUrl = (url: string): boolean => /^https?:\/\//i.test(url);

/** 縦に積む行。2 行目からは上に余白を空ける */
const renderRows = (rows: readonly string[], gap: number): string => {
  const cells = rows
    .map(
      (row, index) =>
        `<tr><td style="${index > 0 ? `padding-top: ${gap}px;` : ""}">${row}</td></tr>`,
    )
    .join("");

  return `<table ${TABLE_ATTRIBUTES} width="100%" style="width: 100%;">${cells}</table>`;
};

/** 余白や枠を付けた箱 */
const renderBox = (style: string, inner: string): string =>
  `<table ${TABLE_ATTRIBUTES} width="100%" style="width: 100%;"><tr><td style="${style}">${inner}</td></tr></table>`;

const renderParagraph = (block: Extract<MailBlock, { type: "paragraph" }>): string =>
  `<div style="${TEXT_STYLE}">${formatHtmlText(block.text)}</div>`;

const renderDetails = (block: Extract<MailBlock, { type: "details" }>): string =>
  renderRows(
    block.rows.map(
      (row) =>
        `<div style="${SMALL_TEXT_STYLE}">${formatHtmlText(row.label)}</div>` +
        `<div style="${TEXT_STYLE} font-weight: 500; word-break: break-word;">${formatHtmlText(row.value)}</div>`,
    ),
    12,
  );

const renderNotice = (block: Extract<MailBlock, { type: "notice" }>): string => {
  const isWarning = block.tone === "warning";
  const borderColor = isWarning ? COLOR_WARNING_BORDER : COLOR_BORDER;
  const backgroundColor = isWarning ? COLOR_WARNING_BACKGROUND : COLOR_CARD_BACKGROUND;
  const title = block.title
    ? `<div style="${TEXT_STYLE} font-weight: bold;">${formatHtmlText(block.title)}</div>`
    : "";

  return renderBox(
    `border: 1px solid ${borderColor}; background-color: ${backgroundColor}; border-radius: 8px; padding: 12px 16px;`,
    `${title}<div style="${TEXT_STYLE}">${formatHtmlText(block.text)}</div>`,
  );
};

const renderQuote = (block: Extract<MailBlock, { type: "quote" }>): string =>
  renderRows(
    [
      `<div style="${SMALL_TEXT_STYLE}">${formatHtmlText(block.title)}</div>`,
      renderBox(
        `border-left: 3px solid ${COLOR_BORDER}; padding-left: 12px; ${TEXT_STYLE} word-break: break-word;`,
        formatHtmlText(block.text),
      ),
    ],
    4,
  );

const renderCode = (block: Extract<MailBlock, { type: "code" }>): string =>
  renderBox(
    `background-color: ${COLOR_MUTED_BACKGROUND}; border-radius: 8px; padding: 16px; text-align: center; font-family: ${CODE_FONT_FAMILY}; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: ${COLOR_FOREGROUND};`,
    escapeHtml(block.value),
  );

const renderAction = (block: Extract<MailBlock, { type: "action" }>): string => {
  const prompt = `<div style="${TEXT_STYLE}">${formatHtmlText(block.prompt)}</div>`;
  const url = `<span style="word-break: break-all;">${escapeHtml(block.url)}</span>`;

  if (!isSafeUrl(block.url)) {
    return renderRows([prompt, `<div style="${SMALL_TEXT_STYLE}">${url}</div>`], 12);
  }

  // 地の色は td に付ける。a 要素の padding を読まないメールソフトでも、ボタンの形が残る
  const button =
    `<table ${TABLE_ATTRIBUTES}><tr><td bgcolor="${COLOR_PRIMARY}" style="background-color: ${COLOR_PRIMARY}; border-radius: 8px;">` +
    `<a href="${escapeHtml(block.url)}" style="display: inline-block; padding: 10px 20px; font-family: ${FONT_FAMILY}; font-size: 14px; font-weight: 500; color: ${COLOR_PRIMARY_FOREGROUND}; text-decoration: none;">${escapeHtml(block.label)}</a>` +
    `</td></tr></table>`;
  const fallback = `<div style="${SMALL_TEXT_STYLE}">ボタンを開けない場合は、次の URL をブラウザーで開いてください。<br>${url}</div>`;

  return renderRows([prompt, button, fallback], 12);
};

const renderFootnotes = (block: Extract<MailBlock, { type: "footnotes" }>): string =>
  block.items
    .map((item) => `<div style="${SMALL_TEXT_STYLE}">※ ${formatHtmlText(item)}</div>`)
    .join("");

const renderBlock = (block: MailBlock): string => {
  switch (block.type) {
    case "paragraph":
      return renderParagraph(block);
    case "details":
      return renderDetails(block);
    case "notice":
      return renderNotice(block);
    case "quote":
      return renderQuote(block);
    case "code":
      return renderCode(block);
    case "action":
      return renderAction(block);
    case "footnotes":
      return renderFootnotes(block);
    default: {
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
};

/**
 * MailContent から HTML 版のメール本文を組み立てる純粋関数。
 *
 * 配色はライトに固定する（color-scheme の meta）。メールソフトが独自に色を反転させることがあり、
 * ダーク用の色を別に持っても、そろえて効かせる手段が無いため。
 */
export const toMailHtml = (content: MailContent): string => {
  const lead = `<h1 style="margin: 0; font-family: ${FONT_FAMILY}; font-size: 18px; font-weight: bold; line-height: 1.5; color: ${COLOR_FOREGROUND};">${formatHtmlText(content.lead)}</h1>`;
  const card = renderRows([lead, ...content.blocks.map(renderBlock)], 16);

  const head =
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<meta name="color-scheme" content="light only">' +
    '<meta name="supported-color-schemes" content="light only">';

  const header = `<tr><td style="padding-bottom: 16px; font-family: ${FONT_FAMILY}; font-size: 16px; font-weight: bold; color: ${COLOR_PRIMARY};">i-Club 予約システム</td></tr>`;
  const body = `<tr><td style="background-color: ${COLOR_CARD_BACKGROUND}; border: 1px solid ${COLOR_BORDER}; border-radius: 10px; padding: 24px;">${card}</td></tr>`;
  const footer = `<tr><td style="padding-top: 16px; ${SMALL_TEXT_STYLE}">${escapeHtml(MAIL_SIGNATURE_NAME)}<br>${escapeHtml(MAIL_SIGNATURE_NOTE)}</td></tr>`;

  // width="600" は max-width を読まないメールソフト（Outlook）のための幅
  const container = `<table ${TABLE_ATTRIBUTES} width="600" style="width: 100%; max-width: 600px; text-align: left;">${header}${body}${footer}</table>`;

  return (
    `<!doctype html><html lang="ja"><head>${head}</head>` +
    `<body style="margin: 0; padding: 0; background-color: ${COLOR_MUTED_BACKGROUND};">` +
    `<table ${TABLE_ATTRIBUTES} width="100%" style="width: 100%; background-color: ${COLOR_MUTED_BACKGROUND};"><tr><td align="center" style="padding: 24px 12px;">${container}</td></tr></table>` +
    `</body></html>`
  );
};
