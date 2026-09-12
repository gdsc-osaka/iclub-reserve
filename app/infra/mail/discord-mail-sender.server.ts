import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { MailAddressee, MailMessage } from "~/domain/mail/mail-message";
import type { MailSender, MailSendError } from "~/domain/mail/mail-sender";

export type DiscordWebhookConfig = {
  /** Discord の「チャンネルの編集 > 連携サービス > ウェブフック」で発行した URL */
  readonly webhookUrl: string;
  /** 投稿先スレッドの ID（スレッドを右クリック > IDをコピー） */
  readonly threadId: string;
};

/** 埋め込み（embed）の description に入れられる文字数の上限。Discord の仕様。 */
const MAX_DESCRIPTION_LENGTH = 4096;

/** 埋め込みの左端に出る帯の色 */
const EMBED_COLOR = 0x3b82f6;

/** 差出人・宛先を `名前 <address>` の形に整える */
const formatAddressee = (addressee: MailAddressee): string =>
  addressee.name ? `${addressee.name} <${addressee.address.value}>` : addressee.address.value;

/** 上限を超える本文は末尾を切る。超えたまま投げると Discord に 400 で拒否されるため。 */
const truncate = (text: string): string =>
  text.length <= MAX_DESCRIPTION_LENGTH ? text : `${text.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`;

/**
 * Webhook の URL に、投稿先スレッドと応答の待ち方を指定するクエリを足す。
 *
 * URL が壊れていると `new URL` が例外を投げるが、その検証は
 * mail-sender-factory 側で済ませてある（不正ならコンソール出力に切り替わる）。
 */
const buildEndpoint = ({ webhookUrl, threadId }: DiscordWebhookConfig): string => {
  const url = new URL(webhookUrl);

  // 指定しないと、Webhook を作ったチャンネル本体の方へ投稿されてしまう。
  url.searchParams.set("thread_id", threadId);
  // 既定では Discord は投稿の完了を待たずに 204 を返す。true にすると実際の
  // 投稿結果が応答に反映されるので、失敗をログに残せる。
  url.searchParams.set("wait", "true");

  return url.toString();
};

/** メール 1 通を Discord の埋め込みメッセージへ変換する */
const buildPayload = (message: MailMessage) => ({
  /*
   * 本文に `@everyone` などが含まれていてもメンションを飛ばさない。
   * 文面はこちらで作っているので今のところ含まれないが、
   * 文面を変えたときに事故らないよう入口で止めておく。
   */
  allowed_mentions: { parse: [] },
  embeds: [
    {
      title: message.subject,
      description: truncate(message.text),
      color: EMBED_COLOR,
      fields: [
        { name: "宛先", value: formatAddressee(message.to) },
        { name: "差出人", value: formatAddressee(message.from) },
      ],
      footer: { text: "プレビュー環境のため、メールを送らずここへ投稿しています" },
      timestamp: new Date().toISOString(),
    },
  ],
});

/** Discord が返した失敗の応答を MailSendError に正規化する */
const toMailSendError = (status: number, body: string): MailSendError => {
  const cause = `HTTP ${status}: ${body}`;

  // 401/403 は Webhook URL が誤っているか、Webhook が削除されているとき。
  if (status === 401 || status === 403) return { type: "auth_failed", cause };

  return { type: "send_failed", cause };
};

/** 応答を Result に振り分ける。失敗時は本文にエラーの詳細が入っているので原因として残す。 */
const toResult = (response: Response): ResultAsync<void, MailSendError> => {
  if (response.ok) return okAsync(undefined);

  return ResultAsync.fromSafePromise(response.text().catch(() => "")).andThen((body) =>
    errAsync(toMailSendError(response.status, body)),
  );
};

/**
 * メールを送る代わりに、Discord の特定のスレッドへ投稿する MailSender の実装。
 *
 * プレビュー環境で認証コード（OTP）を受け取るための仕組み。実在のメールアドレスを
 * 用意しなくても、スレッドを見られる人なら誰でもログインを試せる。
 * 裏を返すと **スレッドを見られる人は誰でもログインできてしまう**ので、
 * スレッドは限定公開にすること。本番では絶対に使わない
 * （mail-sender-factory 側で、プレビュー以外ではこの実装を選ばないようにしてある）。
 */
export const createDiscordMailSender = (config: DiscordWebhookConfig): MailSender => ({
  send(message) {
    return ResultAsync.fromPromise(
      fetch(buildEndpoint(config), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload(message)),
      }),
      // fetch が例外を投げるのは接続そのものに失敗したときだけ。
      // HTTP のエラー応答は例外にならないので、下の toResult で扱う。
      (cause): MailSendError => ({ type: "connection_failed", cause }),
    ).andThen(toResult);
  },
});
