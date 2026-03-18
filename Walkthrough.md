# i-Club Reserve 予約システム デモ

Remix v3 (experimental) と Cloudflare Pages/Workers + D1 を用いて構築された、大阪大学 i-Club 向けの施設予約システムデモアプリです。

## 概要

このプロジェクトは、アカウント登録やメール送信といった複雑なインフラを構築する前の「デモ・検証用」として作成しました。
デプロイ後すぐに機能を体験できるように、以下の工夫が施されています。

- **モック認証**: パスワード入力なしで、Admin（管理者）、Student Owner（団体代表者）、Student Member（一般メンバー）の3つのデモアカウントを切り替えてログインできます。
- **疑似メール通知（トースト）**: 実際のメール送信の代わりに、予約申請や承認・却下などのアクション時に画面右下のトースト通知で「メールを送信しました」というメッセージを表示します。

## 主な機能

1. **施設一覧・表示**: Cloudflare D1データベースに登録された施設の一覧と詳細情報を表示します。
2. **予約申請フロー**: 対象施設の空き状況を確認し（モックベースで）、日時や利用人数、備考を入力して予約申請（仮予約）を行います。
3. **ダッシュボード機能**:
   - **ユーザー側**: 所属団体が申請した予約のステータス確認およびキャンセルが行えます。
   - **管理者側**: 申請されたすべての「仮予約」を一覧で確認し、「承認」または「却下」を行うことができます。

## UI・デザイン

- **Glassmorphism**: プレミアム感を出すために、すりガラス風の効果（`backdrop-filter`）を取り入れたカードデザインやパネルを使用しています。
- **なめらかなアニメーション**: 背景にゆっくりと動くグラデーションアニメーションを配置し、生きたアプリを演出しています。
- **Tailwind等非依存**: 柔軟なカスタマイズのため、あえてフレームワークを使用せずVanilla CSS ([app/styles/global.css](file:///home/itako/iclub-reserve/app/styles/global.css)) にてすべてのシステムトークンを定義・実装しています。

## 技術スタック詳細

- **Framework**: `remix@3.0.0-alpha.3` (fetch-router APIを利用したPreactベースのカスタムSSR構成)
- **View Library**: Preact (`h`, `Fragment`, `preact-render-to-string`)
- **Build Tool**: ESBuild (Node.js と Cloudflare Worker 向けのコードバンドル)
- **Database**: Cloudflare D1 (SQLiteベースのサーバーレスデータベース)
- **Package Manager**: pnpm

## ローカルでの実行・テスト方法

このプロジェクトは以下のコマンドを実行することで、Cloudflare Wranglerを使用したローカルシミュレータ上で動作確認が可能です。

```bash
# 依存関係のインストール (初回のみ)
pnpm install

# ローカルデータベースの初期化とシードデータの投入 (初回のみ)
pnpm run db:init
pnpm run db:seed

# 開発用サーバーの起動
pnpm run dev
```

起動後、コンソールに表示されるURL（通常は `http://localhost:8787`）にブラウザでアクセスしてください。

## デプロイについて

Cloudflare Pages または Workers へデプロイするには以下のコマンドを使用します（Wranglerでの認証が必要です）。

```bash
pnpm run deploy
```

> [!NOTE]
> デプロイ前に、Cloudflareダッシュボード上またはWrangler経由で本番環境用のD1データベース (`reserve-db`) を作成し、[wrangler.toml](file:///home/itako/iclub-reserve/wrangler.toml) 内の `database_id` を正しいものに書き換える必要があります。
