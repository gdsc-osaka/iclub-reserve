# iclub-reserve

阪大 Innovators' Club（i-Club）向けの施設・設備予約システムです。団体（学生）からの予約申請と事務局による承認・管理、および Google Calendar との連携機能を備えています。

## アーキテクチャ・技術スタック

本プロジェクトは、**機能ベース（バーティカル）開発**を前提に、フルスタックな技術構成を採用しています。

- **言語**: TypeScript
- **フロントエンド・バックエンド**: [React Router v8](https://reactrouter.com/) (旧 Remix)
  - ルート単位で UI コンポーネント、データ取得（Loader）、更新処理（Action）を統合
- **スタイリング**: [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- **データベース**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite)
  - ORM: [Drizzle ORM](https://orm.drizzle.team/)
- **認証**: [Better Auth](https://better-auth.com/)
  - `osaka-u.ac.jp` ドメイン限定のメール（マジックリンク / 認証コード）認証
- **インフラ・ホスティング**: [Cloudflare Workers](https://www.cloudflare.com/products/workers/)
  - IaC: [Terraform](https://developer.hashicorp.com/terraform) を用いたインフラ定義と管理
- **パッケージマネージャー**: [pnpm](https://pnpm.io/)

## ドキュメント

- [製品要件定義書 (PRD)](./docs/prd.md)
- [RDRA成果物・要件定義](./rdra/)

## AI エージェント向けスキル

要求分析手法 RDRA 3.0 に基づく `rdra` スキルを同梱しています。要件定義・PRD の作成・要求のレビュー・要件の更新などを AI エージェントに依頼すると自動的に読み込まれ、`rdra/` および `docs/prd.md` と同じ形式で成果物を出力します。

| パス | 役割 |
| --- | --- |
| `.agents/skills/rdra/` | スキルの実体。Antigravity (agy) はこちらを直接読み込みます |
| `.claude/skills/rdra` | `.agents/skills/rdra` へのシンボリックリンク。Claude Code 用 |

> [!IMPORTANT]
> Windows で clone した場合、Git がシンボリックリンクを展開せず、リンク先のパスが書かれただけの
> テキストファイルとしてチェックアウトすることがあります。この状態になるとスキルはエラーも出さず、
> 単に読み込まれません。
>
> `.claude/skills/rdra` がディレクトリではなくファイルになっていたら、次を実行してください。
> 未コミットの変更には影響しません。
>
> ```bash
> git config core.symlinks true
> git checkout -- .claude/skills/rdra
> ```
>
> シンボリックリンクの展開には Windows の「開発者モード」（設定 → システム → 開発者向け）を
> 有効にしておく必要があります。

## 開発環境のセットアップ

### 前提条件

- [Node.js](https://nodejs.org/ja/download) (v24 以上推奨)
- [pnpm](https://pnpm.io/installation)
- [Terraform](https://developer.hashicorp.com/terraform/install) (インフラ変更時のみ)

### インストール

依存関係のインストール:

```bash
pnpm install
```

ローカル環境の DB へのマイグレーションの適用

```bash
pnpm run db:migrate:local
```

> [!IMPORTANT]
> ローカルの DB ファイルは、参照先の D1 データベースごとに別々に作られます。
> 環境分離の対応でローカルの参照先が `iclub-reserve-preview-db` に変わったため、
> それ以前から開発していた場合はマイグレーションの再適用が必要です。
>
> また、古い DB ファイルが残っていると `pnpm run db:studio` が
> 「対象の .sqlite ファイルを一意に特定できません」というエラーで止まります。
> その場合は `.wrangler/state/v3/d1/miniflare-D1DatabaseObject` から
> エラーメッセージに出た古いファイルを削除してください。

### ローカル開発

開発サーバーの起動（HMR 対応）:

```bash
pnpm run dev
```

### データベースのシード（テストデータ投入）

ローカル環境の DB にテストデータ（施設、ユーザー、団体、予約サンプル）を投入します：

```bash
pnpm run db:seed
```

プレビュー環境（リモート D1）に投入する場合は以下を実行します：

```bash
pnpm run db:seed:preview
# または
pnpm run db:seed --remote
```

> [!TIP]
> 開発サーバーの起動後に、別ターミナルで以下のコマンドを実行すると、DB の内容を直接確認・変更できる Drizzle Studio を起動できます。
> `https://local.drizzle.studio` で利用可能です。
>
> ```bash
> pnpm run db:studio
> ```

## 環境とデプロイ

Cloudflare 上には本番とプレビューの 2 つの環境があり、Worker も D1 データベースも完全に別物です。プレビュー側で DB を壊しても本番には影響しません。

| 環境       | ブランチ             | Worker                  | D1                         | URL                                                    |
| ---------- | -------------------- | ----------------------- | -------------------------- | ------------------------------------------------------ |
| 本番       | `main`               | `iclub-reserve`         | `iclub-reserve-db`         | 本番ドメイン                                           |
| プレビュー | `develop` とその派生 | `iclub-reserve-preview` | `iclub-reserve-preview-db` | `https://iclub-reserve-preview.gdsc-osaka.workers.dev` |
| ローカル   | —                    | （デプロイしない）      | ローカルの SQLite          | `http://localhost:5173`                                |

デプロイは Cloudflare Workers Builds が自動で行うため、通常は手元から実行する必要はありません。

### `--env` の指定について

このプロジェクトは `@cloudflare/vite-plugin` を使っており、**環境の切り替えはビルド時に決まります**。`wrangler deploy --env production` のように後から `--env` を付けても、ビルド済みの設定が優先されるため切り替わりません。

そのため、環境を指定するときは必ず用意されたスクリプトを使ってください。ビルド時（`CLOUDFLARE_ENV`）とデプロイ時（`--env`）の両方を指定しており、食い違うと wrangler がエラーで止まるようになっています。

```bash
pnpm run deploy
```

```bash
pnpm run deploy:preview
```

### マイグレーションの適用

```bash
pnpm run db:migrate:preview
```

```bash
pnpm run db:migrate:prod
```

> [!CAUTION]
> `db:migrate:prod` は本番の DB を直接書き換えます。実行前に必ず内容を確認してください。

### Workers Builds のビルド変数

Node.js と pnpm のバージョンは、リポジトリの設定だけでは決まりません。

- Node.js: `.node-version` で指定（リポジトリ管理）
- pnpm: Cloudflare ダッシュボードの **Settings > Build > Build Variables and Secrets** で `PNPM_VERSION` を設定

`wrangler.jsonc` の `vars` はランタイム変数であり、ビルドイメージは参照しません。pnpm を指定しないとビルドイメージ既定の 10 系が使われるので、両方の Worker に設定してください。
