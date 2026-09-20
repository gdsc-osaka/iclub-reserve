import { MailSendErrorCode, type MailSendError } from "./mail-sender";

/**
 * worker-mailer の例外メッセージから 3 桁の SMTP 応答コードを抽出して
 * ドメイン層の MailSendError に分類する純粋関数。
 *
 * 【判定の優先順位】
 * 1. 3 桁の応答コード（254 / 4xx / 535 / 5xx）を最優先で判定する。
 *    件名や本文に "timeout" や "auth" などの語が含まれていても誤判定しないようにするため。
 * 2. 応答コードが取得できなかった場合（接続断・タイムアウトなどサーバー応答が無い場合）は、
 *    キーワード（connect / socket / timeout など）による判定にフォールバックする。
 *
 * @param message worker-mailer が投げた例外メッセージ
 * @param cause エラーの原因オブジェクト（省略時は message）
 */
export const classifySmtpError = (message: string, cause: unknown = message): MailSendError => {
  // ": 455 " や "535 5.7.8" のように、コロン後または先頭/空白に続く 3 桁の応答コードを探す
  // "host:465" のようなポート番号の誤検知を防ぐため、前後に空白またはコロン+空白を要求する
  const codeMatch = /(?:(?::\s+)|(?:^|\s+))([245]\d{2})(?:\s+|$|\.)/.exec(message);

  if (codeMatch) {
    const code = codeMatch[1];

    // 254: 宛先が抑制リスト（Suppression list）に登録されているため恒久的に届かない
    if (code === "254") {
      return {
        code: MailSendErrorCode.Rejected,
        message: "宛先が抑制リストに登録されているため送信できません。",
        cause,
      };
    }

    // 421 / 455 など 4xx: 接続過多・レート制限・一時的なサーバー都合。再試行すべき
    if (code.startsWith("4")) {
      return {
        code: MailSendErrorCode.RateLimited,
        message: "SMTP サーバーが一時的に受け付けられない状態です。",
        cause,
      };
    }

    // 535: SMTP 認証の失敗（ユーザー名・パスワード誤り）。再試行しても無駄
    if (code === "535") {
      return {
        code: MailSendErrorCode.AuthFailed,
        message: "SMTP の認証に失敗しました。",
        cause,
      };
    }

    // その他の 5xx: 宛先不明・不正なアドレスなど恒久的な拒否
    if (code.startsWith("5")) {
      return {
        code: MailSendErrorCode.Rejected,
        message: "SMTP サーバーに恒久的に拒否されました。",
        cause,
      };
    }
  }

  // 応答コードが無い場合（接続失敗・タイムアウト等）はキーワードで判定
  if (/connect|socket|timeout|prohibited|network|econn/i.test(message)) {
    return {
      code: MailSendErrorCode.ConnectionFailed,
      message: "SMTP サーバーに接続できませんでした。",
      cause,
    };
  }

  if (/auth/i.test(message)) {
    return {
      code: MailSendErrorCode.AuthFailed,
      message: "SMTP の認証に失敗しました。",
      cause,
    };
  }

  return {
    code: MailSendErrorCode.SendFailed,
    message: "メールの送信に失敗しました。",
    cause,
  };
};
