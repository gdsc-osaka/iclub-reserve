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
 * この端末そのものにパスキーを保存できるかを調べる。
 *
 * 名前のとおり非同期で、ブラウザによっては答えが返るまで少し時間がかかる。
 */
const detectPlatformAuthenticator = async (): Promise<boolean> => {
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    // 判定できない環境では、勧めない側に倒す。
    return false;
  }
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

    // WebAuthn 自体に対応していないブラウザ。
    if (typeof window.PublicKeyCredential === "undefined") {
      setSupport({ status: "unsupported", canRegisterOnThisDevice: false });
      return;
    }

    void detectPlatformAuthenticator().then((canRegisterOnThisDevice) => {
      if (abandoned) return;
      setSupport({ status: "supported", canRegisterOnThisDevice });
    });

    return () => {
      abandoned = true;
    };
  }, []);

  return support;
};
