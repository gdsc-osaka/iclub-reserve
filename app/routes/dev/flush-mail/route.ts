import { env } from "cloudflare:workers";
import { data } from "react-router";
import { createDb } from "~/infra/db";
import { createD1MailOutbox } from "~/infra/mail/d1-mail-outbox";
import { createMailSender, getMailFrom } from "~/infra/mail/mail-sender-factory.server";
import { flushMailOutboxUseCase } from "~/usecases/mail/flush-mail-outbox.server";

/**
 * 開発専用のメール outbox 手動フラッシュエンドポイント（ADR-002 実装ガイド 5）。
 *
 * react-router dev では cron も queue も自動では走らないため、
 * 手動で outbox の回収・送信を実行できるようにする。
 * 本番やプレビューで実行されると外部から送信処理を好きなだけ起動できてしまうため、
 * APP_ENV が local 以外のときは 404 を返す。
 */
export async function action() {
  if (env.APP_ENV !== "local") {
    throw new Response(null, { status: 404 });
  }

  const db = createDb(env.DB);
  const mailOutbox = createD1MailOutbox(db);
  const mailSender = createMailSender();
  const from = getMailFrom();

  const result = await flushMailOutboxUseCase({
    mailOutbox,
    mailSender,
    from,
  });

  return data(result);
}
