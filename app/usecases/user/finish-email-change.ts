import { ErrorKind } from "~/domain/error";
import { createEmailChangedMailDraft } from "~/domain/mail/email-changed-mail";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import { logFailure } from "~/lib/log.server";
import { requestImmediateDelivery } from "~/usecases/_shared/mail-delivery";

/** ログを絞り込む目印。切り替えの後処理は Better Auth の `hooks.after` から呼ばれる */
const LOG_WHERE = "auth.change-email.after";

/**
 * ログに残すコード。ドメインのエラーではないので、ここで名前だけ決めておく。
 *
 * どちらも、切り替えが済んだ後の失敗なので利用者には伝わらない。
 * 運用でこのコードのログに気づいたら、事務局が手で対応する（EVT-016）。
 */
export const FinishEmailChangeLogCode = {
  /** 変更の通知（EVT-016）を outbox へ積めなかった */
  NoticeNotEnqueued: "EMAIL_CHANGE_NOTICE_NOT_ENQUEUED",
  /** 変更に使った端末以外のログインを終わらせられなかった */
  SessionsNotRevoked: "EMAIL_CHANGE_SESSIONS_NOT_REVOKED",
} as const;

export interface FinishEmailChangeInput {
  readonly userId: string;
  /** 通知の宛名。空なら宛名を付けない */
  readonly userName: string;
  /** 変更前のアドレス。通知の宛先になる */
  readonly previousEmail: string;
  readonly newEmail: string;
  /** 変更に使った端末のセッションのトークン。これだけはログアウトさせない */
  readonly currentToken: string;
  readonly changedAt: Date;
}

export interface FinishEmailChangeDeps {
  /** メールを単独で outbox へ積み、積んだ行の ID を返す（`insertMailsAlone`） */
  readonly enqueueMails: (mails: readonly MailDraft[]) => Promise<readonly string[]>;
  /** outbox に積んだメールの即時配送を依頼する先（ADR-002 決定 1） */
  readonly mailOutboxNotifier: MailOutboxNotifier;
  /**
   * ログイン中の端末（INFO-011）の読み書き。
   *
   * Better Auth の `internalAdapter` をそのまま渡せるよう、使う 2 つだけを同じ形で書いている。
   */
  readonly sessionStore: {
    listSessions(userId: string): Promise<readonly { readonly token: string }[]>;
    deleteSessions(tokens: string[]): Promise<void>;
  };
  /** 通知の本文に書く事務局の窓口のアドレス（`STAFF_CONTACT_EMAIL`） */
  readonly staffContactEmail: string;
}

export type FinishEmailChangeUseCase = (input: FinishEmailChangeInput) => Promise<void>;

/**
 * メールアドレスの切り替えが済んだ後の処理（UC-023 / EVT-016 / COND-018）。
 *
 * 1. 変更前のアドレスへ変更の通知を積み、即時配送を頼む。
 * 2. 変更に使った端末以外のログインをすべて終わらせる。
 *
 * 順序は BUC-024 の業務フローに合わせている。
 * 1 が失敗しても 2 は必ず行う。第三者が変更前のアドレスでログインしていた場合に、
 * そのログインを残さないことの方が、通知よりも大事なためである。
 *
 * どちらの失敗も例外にはせず、エラーのレベルでログに残すだけにする。
 * 切り替え自体は Better Auth がすでに済ませているので、ここで例外を投げて応答を 500 にすると、
 * 利用者は「変更できなかった」と思い込んでしまう。
 */
export const createFinishEmailChangeUseCase =
  (deps: FinishEmailChangeDeps): FinishEmailChangeUseCase =>
  async (input) => {
    await enqueueNotice(deps, input);
    await revokeOtherSessions(deps, input);
  };

/** 変更の通知（EVT-016）を積む。失敗はログに残すだけ。 */
const enqueueNotice = async (
  deps: FinishEmailChangeDeps,
  input: FinishEmailChangeInput,
): Promise<void> => {
  try {
    const draft = createEmailChangedMailDraft({
      userId: input.userId,
      userName: input.userName,
      previousEmail: input.previousEmail,
      newEmail: input.newEmail,
      changedAt: input.changedAt,
      staffContactEmail: deps.staffContactEmail,
    });

    const ids = await deps.enqueueMails([draft]);
    requestImmediateDelivery(deps.mailOutboxNotifier, ids);
  } catch (cause) {
    logFailure({
      level: "error",
      where: LOG_WHERE,
      code: FinishEmailChangeLogCode.NoticeNotEnqueued,
      kind: ErrorKind.Internal,
      userId: input.userId,
      message:
        "メールアドレスの変更の通知を outbox へ積めなかった。事務局から変更前のアドレスへ連絡すること。",
      /*
       * 変更前のアドレスをログに残す。EVT-016 は、事務局がこのログを見て変更前のアドレスへ手で連絡することを求めているが、
       * 切り替えた後の DB にはこのアドレスがもう残っていない。
       * ADR-004 決定 9 が禁じているのは利用者が入力した値を残すことで、変更前のアドレスはそれに当たらない。
       * 変更後のアドレス（入力された値）は残さない。
       */
      details: { previousEmail: input.previousEmail },
      cause,
    });
  }
};

/** 変更に使った端末以外のログインを終わらせる。失敗はログに残すだけ。 */
const revokeOtherSessions = async (
  deps: FinishEmailChangeDeps,
  input: FinishEmailChangeInput,
): Promise<void> => {
  try {
    const sessions = await deps.sessionStore.listSessions(input.userId);
    const otherTokens = sessions
      .map((session) => session.token)
      .filter((token) => token !== input.currentToken);

    if (otherTokens.length > 0) {
      await deps.sessionStore.deleteSessions(otherTokens);
    }
  } catch (cause) {
    logFailure({
      level: "error",
      where: LOG_WHERE,
      code: FinishEmailChangeLogCode.SessionsNotRevoked,
      kind: ErrorKind.Internal,
      userId: input.userId,
      message: "メールアドレスの変更の後、ほかの端末のログインを終わらせられなかった。",
      cause,
    });
  }
};
