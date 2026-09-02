import { useEffect, useState } from "react";

/**
 * この環境でパスキーをどこまで使えるか。
 *
 * `status` と `canRegisterOnThisDevice` は用途が違うので使い分けること。
 *
 * - **登録を勧めるとき**は `canRegisterOnThisDevice` を見る。
 *   「この端末に保存できる」ときだけ勧めたいため。
 * - **ログインの手段として出すとき**は `status` を見る。
 *   端末に保存できなくても、セキュリティキーや
 *   スマートフォンの QR コード経由でログインできる人がいるため。
 */
export type PasskeySupport = {
  /**
   * パスキーを扱える環境かどうか。
   *
   * 判定はブラウザでしかできないので、サーバー側での描画中と
   * 判定が終わるまでの一瞬は "unknown" になる。
   * この間は何も描画しないこと（サーバーとクライアントで
   * 表示が食い違うと React が警告を出すため）。
   */
  readonly status: "unknown" | "unsupported" | "supported";

  /**
   * この端末そのものにパスキーを保存できるかどうか。
   *
   * Windows Hello・Touch ID・Android の画面ロックなどが使える状態を指す。
   * 判定が終わるまでは false。
   */
  readonly canRegisterOnThisDevice: boolean;
};

/** 判定が終わるまでの値。 */
const UNKNOWN: PasskeySupport = { status: "unknown", canRegisterOnThisDevice: false };

/**
 * ブラウザに問い合わせて、実際に判定する。
 *
 * 名前のとおり非同期で、ブラウザによっては答えが返るまで少し時間がかかる。
 */
const askBrowser = async (): Promise<PasskeySupport> => {
  // WebAuthn 自体に対応していないブラウザ。
  if (typeof window.PublicKeyCredential === "undefined") {
    return { status: "unsupported", canRegisterOnThisDevice: false };
  }

  try {
    const canRegisterOnThisDevice =
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return { status: "supported", canRegisterOnThisDevice };
  } catch {
    // 判定できない環境では、勧めない側に倒す。
    return { status: "supported", canRegisterOnThisDevice: false };
  }
};

/**
 * 一度始めた判定を、ページを開いている間ずっと使い回すための入れ物。
 *
 * 答えは操作の途中で変わらないので、画面ごとに問い合わせ直す必要はない。
 * 結果ではなく約束（Promise）を覚えておくことで、
 * 判定の途中で誰が呼んでも、同じ 1 回の答えを待てるようになる。
 */
let detection: Promise<PasskeySupport> | null = null;

/**
 * パスキーに対応した環境かどうかを調べる。ブラウザ側でのみ呼べる。
 *
 * 描画に合わせて値がほしいときは `usePasskeySupport` を使うこと。
 * こちらは「ボタンが押された、その時点の答えが確実にほしい」ときのためにある。
 * `usePasskeySupport` は判定が終わるまで "unknown" を返すので、
 * 終わる前に操作されると、対応した端末を非対応として扱ってしまう。
 */
export const detectPasskeySupport = (): Promise<PasskeySupport> => {
  detection ??= askBrowser();
  return detection;
};

/**
 * パスキーに対応した環境かどうかを調べる。
 *
 * 判定にはブラウザの API が要るため、必ず画面の描画が終わってから実行する。
 * そのため最初の 1 回は必ず "unknown" が返る。
 */
export const usePasskeySupport = (): PasskeySupport => {
  const [support, setSupport] = useState<PasskeySupport>(UNKNOWN);

  useEffect(() => {
    // 判定を待っている間に画面が切り替わったら、結果は捨てる。
    let abandoned = false;

    void detectPasskeySupport().then((result) => {
      if (abandoned) return;
      setSupport(result);
    });

    return () => {
      abandoned = true;
    };
  }, []);

  return support;
};
