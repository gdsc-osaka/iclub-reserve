import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDiscordMailSender } from "./discord-mail-sender.server";
import { createMailMessage } from "~/domain/mail/mail-message";

const config = {
  webhookUrl: "https://discord.com/api/webhooks/123/token",
  threadId: "456",
};

const message = createMailMessage({
  from: { address: "noreply@gdgoc-osaka.jp", name: "i-Club 予約システム" },
  to: { address: "taro@osaka-u.ac.jp" },
  subject: "【i-Club予約システム】ログイン用の認証コード",
  text: "認証コードは 123456 です。",
})._unsafeUnwrap();

/** fetch の代わりに使う関数。呼び出し内容の検証にも使う。 */
let fetchMock: ReturnType<typeof vi.fn>;

/** 指定したステータスの応答を返すよう fetch を仕込む */
const respondWith = (status: number, body = "") => {
  fetchMock.mockResolvedValue(new Response(body, { status }));
};

/** fetch に渡されたリクエストの本文を JSON として取り出す */
const requestBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createDiscordMailSender", () => {
  it("スレッドを指定して Webhook に POST する", async () => {
    respondWith(200, "{}");

    const result = await createDiscordMailSender(config).send(message);

    expect(result.isOk()).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    const { searchParams, origin, pathname } = new URL(url);

    expect(origin + pathname).toBe(config.webhookUrl);
    expect(searchParams.get("thread_id")).toBe(config.threadId);
    // 投稿の成否を応答で受け取るために必要
    expect(searchParams.get("wait")).toBe("true");
    expect(init.method).toBe("POST");
  });

  it("件名と本文を埋め込みに載せ、メンションを飛ばさない", async () => {
    respondWith(200, "{}");

    await createDiscordMailSender(config).send(message);

    const body = requestBody();
    const embed = body.embeds[0];

    expect(embed.title).toBe(message.subject);
    expect(embed.description).toContain("123456");
    expect(JSON.stringify(embed.fields)).toContain("taro@osaka-u.ac.jp");
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it("上限を超える本文は切り詰めて送る", async () => {
    respondWith(200, "{}");

    const longMessage = createMailMessage({
      from: { address: "noreply@gdgoc-osaka.jp" },
      to: { address: "taro@osaka-u.ac.jp" },
      subject: "長い本文",
      text: "あ".repeat(5000),
    })._unsafeUnwrap();

    await createDiscordMailSender(config).send(longMessage);

    // Discord の埋め込みの description は 4096 文字まで
    expect(requestBody().embeds[0].description).toHaveLength(4096);
  });

  it("Webhook URL が無効なら auth_failed を返す", async () => {
    respondWith(401, '{"message":"Invalid Webhook Token"}');

    const result = await createDiscordMailSender(config).send(message);

    expect(result._unsafeUnwrapErr().type).toBe("auth_failed");
  });

  it("その他の失敗応答は send_failed を返し、応答の内容を原因に残す", async () => {
    respondWith(400, '{"message":"Unknown Channel"}');

    const error = (await createDiscordMailSender(config).send(message))._unsafeUnwrapErr();

    expect(error.type).toBe("send_failed");
    expect(String(error.cause)).toContain("Unknown Channel");
  });

  it("応答を待ち続けないよう、打ち切り用の signal を渡す", async () => {
    respondWith(200, "{}");

    await createDiscordMailSender(config).send(message);

    // Workers は fetch そのものに時間の上限を設けないため、渡していないと
    // Discord が応答を返さないまま送信処理が待ち続けてしまう。
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("時間切れになったら connection_failed を返す", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation was aborted", "TimeoutError"));

    const result = await createDiscordMailSender(config).send(message);

    expect(result._unsafeUnwrapErr().type).toBe("connection_failed");
  });

  it("接続できなければ connection_failed を返す", async () => {
    fetchMock.mockRejectedValue(new Error("network error"));

    const result = await createDiscordMailSender(config).send(message);

    expect(result._unsafeUnwrapErr().type).toBe("connection_failed");
  });
});
