import type { MailContent } from "./mail-content";
import { toMailText } from "./mail-content";
import { toMailHtml } from "./mail-content-html";

/**
 * MailContent から、テキスト版と HTML 版の両方の本文を作る純粋関数（ADR-018）。
 *
 * メールを組み立てる関数は、中身を 1 回だけ組み立ててここへ渡し、
 * 返った 2 つを MailDraft の text と html に入れる。別々に書かないので、2 つの内容がずれない。
 */
export const toMailBodies = (
  content: MailContent,
): { readonly text: string; readonly html: string } => ({
  text: toMailText(content),
  html: toMailHtml(content),
});
