import type { ResultAsync } from "neverthrow";
import type { PasskeyProviderIcon } from "~/domain/authn/passkey-provider";
import type { QueryError } from "../error";

/** パスキー一覧に並ぶパスキー 1 件分のデータ */
export interface AccountPasskeyItem {
  readonly id: string;
  readonly label: string;
  /** 提供元のアイコン。AAGUID から提供元が分からなければ null */
  readonly icon: PasskeyProviderIcon | null;
  readonly credentialID: string;
  readonly backedUp: boolean;
  readonly createdAt: Date | null;
  readonly lastUsedAt: Date | null;
}

/** ログイン中の端末一覧に並ぶセッション 1 件分のデータ（トークンは含まない） */
export interface AccountSessionItem {
  readonly id: string;
  readonly deviceName: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly isCurrent: boolean;
}

/** アカウント設定画面に表示するデータ */
export interface AccountSettingsData {
  readonly passkeys: readonly AccountPasskeyItem[];
  readonly sessions: readonly AccountSessionItem[];
}

/**
 * アカウント設定画面用の読み取り専用窓口（ポート）。
 */
export interface AccountSettingsQuery {
  /**
   * 指定したユーザーのパスキー一覧および有効なログイン中セッション一覧を取得する。
   *
   * @param userId 取得対象のユーザー ID
   * @param currentSessionId 現在利用中のセッション ID
   * @param now 現在日時（有効期限切れセッションの除外に使用）
   */
  findByUserId(
    userId: string,
    currentSessionId: string,
    now: Date,
  ): ResultAsync<AccountSettingsData, QueryError>;
}
