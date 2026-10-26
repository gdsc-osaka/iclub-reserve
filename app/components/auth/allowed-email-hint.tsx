import { Fragment } from "react";

import { ALLOWED_EMAIL_ADDRESSES_HINT } from "~/domain/authn/allowed-email-domain";

/** 文の中のアドレスのドメイン部分（「@」から、英数字・ドット・ハイフンが続くところまで）。 */
const ADDRESS_PATTERN = /(@[\w.-]+)/;

/**
 * 使えるメールアドレスの案内文。
 * `ALLOWED_EMAIL_ADDRESSES_HINT` の後に `suffix`（「のみご利用いただけます。」など）を続けて出す。
 *
 * 文の中のアドレスは途中で改行させない。ブラウザはハイフンの後ろを改行してよい位置とみなすので、
 * そのままだと「@ecs.osaka-」と「u.ac.jp」の 2 行に割れて、読み違えやすくなる。
 */
export function AllowedEmailHint({ suffix }: Readonly<{ suffix: string }>) {
  // 括弧付きの正規表現で split すると、区切りにしたアドレスも奇数番目に残る
  const parts = `${ALLOWED_EMAIL_ADDRESSES_HINT}${suffix}`.split(ADDRESS_PATTERN);

  return parts.map((part, index) => (
    // 文言は固定で並びが変わらないので、位置を key にしてよい
    <Fragment key={index}>
      {index % 2 === 1 ? <span className="whitespace-nowrap">{part}</span> : part}
    </Fragment>
  ));
}
