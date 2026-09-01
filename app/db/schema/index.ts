/**
 * DB スキーマの入口。
 *
 * スキーマは 2 つに分かれている。
 *
 * - `auth.ts`: Better Auth が管理するテーブル。
 *   `pnpm db:auth:generate` が**ファイルごと上書きする**ので、手で編集しないこと。
 *   列を足したいときは `app/lib/auth/auth.server.ts` の設定（`additionalFields` や
 *   プラグイン）を直してから、生成し直す。
 * - `reservation.ts`: このアプリ独自のテーブル。こちらは手で書く。
 *
 * 参照する側は今までどおり `~/db/schema` から import すればよい。
 *
 * なお `db:auth:generate` が使う CLI（`auth`）は devDependency として
 * バージョンを固定してある。CLI は better-auth の実装を読んでスキーマを組み立てるため、
 * pnpm-workspace.yaml の catalog と overrides で、CLI が**アプリと同じ better-auth**を
 * 使うようにしてある。`better-auth` を上げるときは catalog と `auth` を合わせて上げること。
 */
export * from "./auth";
export * from "./reservation";
