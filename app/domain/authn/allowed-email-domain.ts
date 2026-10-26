/**
 * アカウントの作成を許可するメールアドレスのドメイン。
 *
 * ここに書いたドメイン本体と、そのサブドメイン（例: ecs.osaka-u.ac.jp）を許可する。
 * 学生も教職員も大阪大学のアドレスは osaka-u.ac.jp のサブドメインになるため、
 * 通常はこの 1 件だけで足りる。対象を増やすときはこの配列に追記する。
 */
export const ALLOWED_EMAIL_DOMAINS = ["osaka-u.ac.jp"] as const;

/** 画面やエラーメッセージで案内するときの文言（例: "@osaka-u.ac.jp"）。 */
export const ALLOWED_EMAIL_DOMAINS_LABEL = ALLOWED_EMAIL_DOMAINS.map((domain) => `@${domain}`).join(
  "・",
);

/**
 * サブドメインも使えることを伝えるための例。
 *
 * 学生のアドレスは ecs.osaka-u.ac.jp になる。案内に「@osaka-u.ac.jp」とだけ書くと、
 * 学生が自分のアドレスは使えないと受け取ってしまうため、案内ではこの例を並べて見せる。
 */
const SUBDOMAIN_EXAMPLE = "ecs.osaka-u.ac.jp";

/**
 * 入力欄の下の案内で、使えるメールアドレスを言い表す語句。
 * 「…のみご利用いただけます。」「…にのみ招待を送れます。」のように、文の頭に置いて使う。
 * 画面では、アドレスの途中で改行させないために `AllowedEmailHint`
 * （app/components/auth/allowed-email-hint.tsx）を通して出す。
 *
 * エラーメッセージには使わない。エラーは許可外のアドレスを入れた人にだけ出るので、
 * ドメイン（`ALLOWED_EMAIL_DOMAINS_LABEL`）を示せば足りる。
 * 許可するドメインを増やしたときは、この語句も見直すこと。
 */
export const ALLOWED_EMAIL_ADDRESSES_HINT = `大阪大学のメールアドレス（${ALLOWED_EMAIL_DOMAINS_LABEL}・@${SUBDOMAIN_EXAMPLE} など）`;

/**
 * 許可外のドメインだったことを表すエラーコード。
 *
 * サーバー（Better Auth）が拒否するときにこのコードを返し、
 * 画面側は `toAuthErrorMessage` で日本語のメッセージに変換する。
 */
export const EMAIL_DOMAIN_NOT_ALLOWED_CODE = "EMAIL_DOMAIN_NOT_ALLOWED";

/**
 * アカウントの作成を許可するメールアドレスかどうかを判定する。
 *
 * ドメイン部分だけを見るので、大文字・小文字や前後の空白は無視する。
 * サブドメインを許可するために「完全一致」か「.ドメイン で終わる」かで判定している
 * （"notosaka-u.ac.jp" のような紛らわしいドメインを弾くため、単純な endsWith は使わない）。
 */
export const isAllowedEmailAddress = (email: string): boolean => {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf("@");

  // "@" がない / ローカル部がない / ドメイン部がない場合は許可しない
  if (atIndex < 1 || atIndex === normalized.length - 1) return false;

  const domain = normalized.slice(atIndex + 1);

  return ALLOWED_EMAIL_DOMAINS.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
  );
};
