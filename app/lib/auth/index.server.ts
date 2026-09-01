/**
 * Better Auth CLI 用のエントリポイント。
 *
 * `pnpm dlx auth@latest generate` は決められたパス（`app/lib/auth/index.server.ts` を含む）から
 * `auth` という名前の export を探して設定を読み取る。
 * `auth.server.ts` はそのパスに含まれないため、ここで橋渡しをしている。
 *
 * アプリのコードからは import しないこと。
 * 読み込んだ時点で Better Auth を初期化してしまうため、
 * 実行時は今までどおり `auth.server.ts` の `getAuth()` を使う。
 */
import { getAuth } from "./auth.server";

/**
 * @deprecated
 *
 * Better Auth CLI 用のエンドポイントのため、
 * 代わりに `./auth.server` の `getAuth()` を使用してください。
 */
export const auth = getAuth();
