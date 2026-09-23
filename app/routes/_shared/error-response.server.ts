import { data } from "react-router";

import { ErrorKind, type BaseError } from "~/domain/error";
import { logFailure, type LogLevel } from "~/lib/log.server";

/**
 * ドメインのエラーを、画面への応答とログに変える共通のグルー（ADR-004 決定 3・5・7・9）。
 *
 * ここはドメインを知らない。文言はドメインごとの表（例: `group-error.server.ts`）が持ち、
 * ここが持つのは「表をどう読むか」だけである。ルートからは直接呼ばず、ドメインごとの薄い関数を通す。
 */

/** 表の 1 行。利用者に何を見せるか */
export interface ErrorView {
  /**
   * 応答の status。省略すると分類（kind）から決まる。
   *
   * 既定を破るときだけ書き、理由をコメントに残すこと。
   * 書いてある行が「ここは既定どおりではない」という印になる。
   */
  readonly status?: number;
  /**
   * 利用者に見せる文言。
   *
   * エラーが `userMessage` を持っていればそちらを出し、無ければこれを出す。
   * 画面ごと差し替える応答（404 など）と `internal` の失敗では、`userMessage` があっても常にこれを出す。
   */
  readonly message: string;
  /**
   * true なら、エラーが `userMessage` を持っていても使わず、常に `message` を出す。
   *
   * 秘匿のために、別の行と同じ応答へ揃えた行に付ける（予約の `NotFound` と `NotVisible` など）。
   * 付けないと、どちらかのエラーに誰かが文言を書いたとき、その文言の有無で 2 つの応答が変わり、
   * 違いから存在を推測されてしまう。
   *
   * status が 404 の行には要らない。画面ごと差し替える応答は、もともと `userMessage` を使わない。
   */
  readonly ignoreUserMessage?: true;
}

/** ドメインごとに用意する 2 枚の表 */
export interface ErrorTables<C extends string> {
  /** コード → 分類。ドメインが持つ（例: `groupErrorKind`） */
  readonly kindOf: Readonly<Record<C, ErrorKind>>;
  /** コード → 見せ方。網羅を強制するため `Partial` にしない */
  readonly viewOf: Readonly<Record<C, ErrorView>>;
}

/** 失敗をログに残すときの、どこで・誰が */
export interface ErrorContext {
  /** どの処理で起きたか（例: `"groups.detail.loader"`）。ログを絞り込む目印 */
  readonly where: string;
  /** 操作した人。無いと、1 人の総当たりと大勢の打ち間違いを見分けられない（ADR-004 決定 9） */
  readonly userId: string;
}

/** このグルーが受け取るドメインのエラー */
export interface DomainError<C extends string, F extends string = never> extends BaseError {
  readonly code: C;
  /** 入力の誤りのとき、どの項目についての誤りか（ADR-004 決定 6） */
  readonly field?: F;
}

/**
 * action が画面へ返す誤りの形。
 *
 * `K` は画面の入力欄の名前（例: `"nameError"`）。欄の下に出すものはそこへ、
 * それ以外はフォームの上に出す `formError` へ入る。どちらか一方だけが文字列になる。
 */
export type ActionErrors<K extends string> = { readonly [P in K]: string | null } & {
  readonly formError: string | null;
};

/** 分類ごとの status の既定 */
const statusOf: Record<ErrorKind, number> = {
  [ErrorKind.NotFound]: 404,
  [ErrorKind.Forbidden]: 403,
  [ErrorKind.InvalidInput]: 400,
  [ErrorKind.Conflict]: 409,
  [ErrorKind.Internal]: 500,
};

/**
 * 分類ごとのログのレベル（ADR-004 決定 9）。
 *
 * 表で上書きできるのは status と文言だけで、レベルは上書きできない。
 * 秘匿が要るのは外部への応答であって、サーバーのログではない。
 */
const logLevelOf: Record<ErrorKind, LogLevel> = {
  [ErrorKind.Internal]: "error",
  // 権限の無い操作は画面に出していないので、通常の操作では起きない
  [ErrorKind.Forbidden]: "warn",
  [ErrorKind.NotFound]: "info",
  [ErrorKind.InvalidInput]: "info",
  [ErrorKind.Conflict]: "info",
};

/**
 * この画面そのものが無いことを表す status。
 *
 * action でもこの status のときだけは誤りを返さずに投げる。フォームを出す先の画面が無いうえ、
 * loader と違う応答を返すと、その違いから存在を推測されうる（COND-011）。
 * そのため、URL ではなくフォームで指したものが無いとき（メンバー・招待など）は、
 * 表でこれ以外の status に上書きすること。
 */
const PAGE_NOT_FOUND_STATUS = 404;

const logDomainError = <C extends string>(
  tables: ErrorTables<C>,
  context: ErrorContext,
  error: DomainError<C, string>,
): void => {
  const kind = tables.kindOf[error.code];
  logFailure({
    level: logLevelOf[kind],
    where: context.where,
    code: error.code,
    kind,
    userId: context.userId,
    message: error.message,
    cause: error.cause,
  });
};

/** 表の行に、分類から決まる既定の status を埋めたもの */
interface ResolvedView {
  readonly status: number;
  readonly message: string;
  readonly ignoreUserMessage: boolean;
}

/** 表の行に、分類から決まる既定の status を埋める */
const resolveView = <C extends string>(tables: ErrorTables<C>, code: C): ResolvedView => {
  const view = tables.viewOf[code];
  return {
    status: view.status ?? statusOf[tables.kindOf[code]],
    message: view.message,
    ignoreUserMessage: view.ignoreUserMessage === true,
  };
};

/**
 * loader 用。ログに残し、ErrorBoundary へ投げる応答を作る。
 *
 * 呼ぶ側は `throw` すること。文言は表のものだけを使い、`userMessage` は使わない。
 * 画面ごと差し替える応答なので、フォームに向けて書かれた文言の出番が無いうえ、
 * 秘匿のために同じ応答へ揃えた行（`NotVisible` など）を `userMessage` で崩せなくするため。
 */
export const toErrorResponse = <C extends string>(
  tables: ErrorTables<C>,
  context: ErrorContext,
  error: DomainError<C, string>,
) => {
  logDomainError(tables, context, error);
  const view = resolveView(tables, error.code);
  return data({ message: view.message }, { status: view.status });
};

/**
 * action 用。ログに残し、画面へ返す誤りを作る。
 *
 * ただし status が 404 になるエラーでは、返さずに `toErrorResponse` の応答を投げる。
 * 詳しくは `PAGE_NOT_FOUND_STATUS` を参照。
 *
 * @param fieldOf ドメインの項目（`field`）から、この画面の入力欄を引く表。
 *   載っていない項目の誤りはフォームの上（`formError`）に出る。
 *   書き忘れても欄の外に出るだけなので `Partial` でよい（ADR-004 決定 6）
 *
 * 返り値の `NoInfer` は、欄の名前 `K` を `fieldOf` からだけ推論させるためのもの。
 * 返り値の受け手（`satisfies` の型）から推論させると、欄が無い画面で `K` が `string` に広がる。
 */
export const toActionErrors = <C extends string, F extends string, K extends string = never>(
  tables: ErrorTables<C>,
  context: ErrorContext,
  error: DomainError<C, F>,
  fieldOf: Partial<Record<F, K>> = {},
): ActionErrors<NoInfer<K>> => {
  const view = resolveView(tables, error.code);
  if (view.status === PAGE_NOT_FOUND_STATUS) {
    throw toErrorResponse(tables, context, error);
  }

  logDomainError(tables, context, error);

  /*
   * internal の失敗は、userMessage を持っていても出さない。内部の事情を画面に漏らさないため。
   * 秘匿のために揃えた行（ignoreUserMessage）も、応答が揃ったままになるよう表の文言だけを出す
   */
  const text =
    tables.kindOf[error.code] === ErrorKind.Internal || view.ignoreUserMessage
      ? view.message
      : (error.userMessage ?? view.message);

  const fieldKeys = Object.values<K | undefined>(fieldOf).filter(
    (key): key is K => key !== undefined,
  );
  const fieldKey = error.field === undefined ? undefined : fieldOf[error.field];

  // 欄の数が画面ごとに違うので、型が組み立てを追えない。形は ActionErrors<K> の説明どおり
  return Object.fromEntries([
    ...fieldKeys.map((key) => [key, key === fieldKey ? text : null]),
    ["formError", fieldKey === undefined ? text : null],
  ]) as ActionErrors<K>;
};
