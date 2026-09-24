import type { CDPSession, Page } from "@playwright/test";

/**
 * パスキーのテストで使う、仮想の認証器。
 *
 * `webAuthn`（`e2e/support/fixtures.ts`）に、この端末に組み込まれた認証器
 * （Windows Hello や Touch ID のようなもの）を 1 台足す。
 * 足すとアプリは「この端末でパスキーを作れる」と判断し、登録の案内やボタンを出す。
 * 本物の認証器と違って指紋や PIN を求めず、ブラウザの問い合わせにすぐ答える。
 */
export interface VirtualAuthenticator {
  /** この認証器に保存されたパスキーの数 */
  countCredentials: () => Promise<number>;
}

/**
 * 仮想の認証器を足す。
 *
 * @param webAuthn テストの `webAuthn`
 */
export async function addVirtualAuthenticator(webAuthn: CDPSession): Promise<VirtualAuthenticator> {
  const { authenticatorId } = await webAuthn.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      // 端末に組み込まれた認証器（USB のセキュリティキーではない）
      transport: "internal",
      // パスキーとして保存でき（resident key）、本人確認（生体認証や PIN）ができる
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      // 問い合わせに、人の操作を待たずに答える
      automaticPresenceSimulation: true,
    },
  });

  return {
    countCredentials: async () => {
      const { credentials } = await webAuthn.send("WebAuthn.getCredentials", { authenticatorId });
      return credentials.length;
    },
  };
}

/**
 * パスキーの自動入力（条件付き UI）に対応していないブラウザとして、画面を開くようにする。
 *
 * ログイン画面は、自動入力に対応したブラウザだと、開いただけでパスキーの問い合わせを始める。
 * 仮想の認証器はその問い合わせにもすぐ答えるので、
 * 「パスキーでログイン」のボタンを押す前にログインが終わってしまうことがある。
 * ボタンでのログインを確かめるときは、画面を開く前にこれを呼ぶ。
 */
export async function disablePasskeyAutofill(page: Page): Promise<void> {
  // 画面のスクリプトより先に、ブラウザの「対応しているか」の答えを「いいえ」に差し替える
  await page.addInitScript(() => {
    // この関数はブラウザの中で動く。E2E の型にはブラウザの型が無いので、使う所だけ型を書く
    const credential = (
      globalThis as {
        PublicKeyCredential?: { isConditionalMediationAvailable?: () => Promise<boolean> };
      }
    ).PublicKeyCredential;
    if (credential) {
      credential.isConditionalMediationAvailable = () => Promise.resolve(false);
    }
  });
}
