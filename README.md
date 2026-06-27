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

### ローカル開発

開発サーバーの起動（HMR 対応）:

```bash
pnpm run dev
```

アプリケーションは `http://localhost:5173` で利用可能になります。
※ ローカルの D1 データベース（SQLite）のシード手順については、追って整備します。

> [!TIP]
> 開発サーバーの起動後に、別ターミナルで以下のコマンドを実行すると、DB の内容を直接確認・変更できる Drizzle Studio を起動できます。
> `https://local.drizzle.studio` で利用可能です。
>
> ```bash
> pnpm run db:studio
> ```
