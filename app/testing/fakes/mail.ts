/**
 * テストからだけ使う。アプリのコードから import しないこと。
 */
import type { MailOutbox } from "~/domain/mail/mail-outbox";
import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import type { MailSender } from "~/domain/mail/mail-sender";
import { createUnimplementedFake } from "./stub";

/**
 * テスト用の MailOutbox の偽物を生成する。
 * 指定されなかったメソッドが呼ばれると Error を投げてテストを失敗させる。
 */
export function fakeMailOutbox(overrides: Partial<MailOutbox> = {}): MailOutbox {
  return createUnimplementedFake("MailOutbox", overrides);
}

/**
 * テスト用の MailSender の偽物を生成する。
 */
export function fakeMailSender(overrides: Partial<MailSender> = {}): MailSender {
  return createUnimplementedFake("MailSender", overrides);
}

/**
 * テスト用の MailOutboxNotifier の偽物を生成する。
 */
export function fakeMailOutboxNotifier(
  overrides: Partial<MailOutboxNotifier> = {},
): MailOutboxNotifier {
  return createUnimplementedFake("MailOutboxNotifier", overrides);
}
