/**
 * 利用者に同意を求める規約（REQ-033）。
 *
 * i-Club の施設を使う人は、大阪大学共創機構人材育成室が定める
 * 「産学共創C棟2階施設使用規約」に従う。予約システムに独自の利用規約は無いため、
 * アカウントを作るときにこの規約への同意を求める。
 *
 * 規約は改定されることがある（規約の第 11 条）。改定されたら `version` を新しい版の施行日に、
 * `url` を新しい PDF に書き換える。同意した版はユーザーごとに記録しているので（`user.terms_version`）、
 * 書き換えた時点で、古い版にしか同意していない人は全員、次の画面遷移で同意の画面へ案内される。
 */
export const TERMS_OF_SERVICE = {
  /** 画面に出す規約の名前 */
  title: "産学共創C棟2階施設使用規約",
  /** 版。施行日を ISO 8601 の日付で書く（令和4年4月1日施行） */
  version: "2022-04-01",
  /** 規約の本文（i-Club のホームページにある PDF） */
  url: "https://ou-iclub.net/wp-content/uploads/2022/12/d2045771651a783bef3c72624155c6c5.pdf",
} as const;

/**
 * 今の版の規約に同意しているかどうか。
 *
 * 一度も同意していない人（`null`）も、古い版にだけ同意した人も、同意していないものとして扱う。
 *
 * @param user `terms_version` は Better Auth のセッションが持つユーザーの列名のまま受け取る
 */
export const hasAcceptedCurrentTerms = (user: {
  readonly terms_version?: string | null;
}): boolean => user.terms_version === TERMS_OF_SERVICE.version;
