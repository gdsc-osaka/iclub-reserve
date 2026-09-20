import { createRequestHandler } from "react-router";
import { createDb } from "~/infra/db";
import { createD1MailOutbox } from "~/infra/mail/d1-mail-outbox";
import { createMailSender, getMailFrom } from "~/infra/mail/mail-sender-factory.server";
import { flushMailOutboxUseCase } from "~/usecases/mail/flush-mail-outbox.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },

  /**
   * 毎分の取りこぼし回収（ADR-002 実装ガイド 4）。
   * 送信待ち（pending）およびクラッシュ等で放置された（sending）メールを回収して送信する。
   */
  async scheduled(_controller, env, _ctx) {
    const db = createDb(env.DB);
    const mailOutbox = createD1MailOutbox(db);
    const mailSender = createMailSender();
    const from = getMailFrom();

    await flushMailOutboxUseCase({
      mailOutbox,
      mailSender,
      from,
    });
  },
} satisfies ExportedHandler<Env>;
