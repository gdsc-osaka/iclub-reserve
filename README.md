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
  - メールの認証コード（OTP）とパスキー（WebAuthn）によるログイン。パスワードは扱いません
  - アカウントを作成できるのは `osaka-u.ac.jp` ドメイン（サブドメイン含む）のメールアドレスのみ
- **インフラ・ホスティング**: [Cloudflare Workers](https://www.cloudflare.com/products/workers/)（設定は `wrangler.jsonc`）
- **開発のツール**: [Vite+](https://viteplus.dev/)
  - 開発サーバー・ビルド（Vite）、単体テスト（Vitest）、リント（Oxlint）、フォーマット（Oxfmt）を 1 つにまとめたもの。設定は `vite.config.ts` にまとめています（[ADR-015](docs/adr/015-vite-plus.md)）
- **パッケージマネージャー**: [pnpm](https://pnpm.io/) 12

## ドキュメント

- [製品要件定義書 (PRD)](./docs/prd.md)
- [RDRA成果物・要件定義](./rdra/)
- [実装状況](./docs/implementation-status.md)
- [設計判断の記録 (ADR)](./docs/adr/)
- [要件変更履歴](./change-log.md)

## AI エージェント向けスキル

- `rdra`: 要求分析手法 RDRA 3.0 に基づき、要件定義・PRD の作成・要求のレビュー・要件の更新を行います。成果物は `rdra/` と `docs/prd.md` の形式で出します
- `local-login`: ローカルの開発サーバーに、シードの利用者としてログインする手順です

スキルの実体は `.agents/skills/<名前>/` にあり、Antigravity (agy) はここを読みます。Claude Code は `.claude/skills/<名前>`（実体へのシンボリックリンク）を読みます。

> [!IMPORTANT]
> Windows で clone すると、Git がシンボリックリンクを、リンク先のパスが書かれただけのテキストファイルとしてチェックアウトすることがあります。この状態ではスキルはエラーも出さずに読み込まれません。
> `.claude/skills/` の中がディレクトリではなくファイルになっていたら、次を実行してください（`.claude/skills/` の中の未コミットの変更は消えます。外の変更には影響しません）。
>
> ```bash
> git config core.symlinks true
> git checkout -- .claude/skills
> ```
>
> シンボリックリンクの展開には Windows の「開発者モード」（設定 → システム → 開発者向け）を
> 有効にしておく必要があります。

## 開発環境のセットアップ

### 前提条件

- [Node.js](https://nodejs.org/ja/download) (v26 以上推奨。v22 なら 22.22.1 以上)
- [pnpm](https://pnpm.io/installation)
  - 使う版は `package.json` の `devEngines.packageManager` で決めています（v12）。手元の pnpm が 11 以降なら、版が違っても `pnpm install` のときに自動でその版に切り替わります

### インストール

依存関係のインストール:

```bash
pnpm install
```

インストールすると、コミットの前に、コミットするファイルのフォーマットとリントの自動修正が走るようになります（`vp staged`）。
リントでは型も確かめるので、型のエラーが残っているとコミットが止まります。
1 回だけ止めるときは `VP_GIT_HOOKS=0 git commit`、ずっと止めるときは `pnpm exec vp hooks disable` を実行してください。

ローカル環境の DB へのマイグレーションの適用

```bash
pnpm run db:migrate:local
```

### エディタ（VS Code）

型チェックには TypeScript 7 を使っています。
VS Code に最初から入っている TypeScript の機能は、TypeScript 7 ではなく VS Code に同梱の別の版で型を確かめます。
拡張機能「[TypeScript 7](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview)」（`TypeScriptTeam.native-preview`）を入れてください。
入れると自動で切り替わり、`pnpm run typecheck` と同じ版でエラーが出るようになります。

このリポジトリを開くと、推奨の拡張機能として表示されます（`.vscode/extensions.json`）。

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

シードには、事務局・団体の管理者・一般メンバー・どの団体にも入っていない人・承認待ちの団体の管理者の 5 人が入っています（`scripts/seed/seed-data.ts` の `seedPersonas`）。E2E テストもこの 5 人を使うので、立場（所属する団体・役割・事務局かどうか）を変えたときは E2E も動かして確かめてください。

### テスト

```bash
pnpm test          # 単体テスト（Vitest。Vite+ の vp test で動かす）
pnpm run test:e2e  # E2E テスト（Playwright）。ビルドしてから画面を操作して確かめる
pnpm lint          # リント（vp lint。型の情報を使い、型のエラーも出す）。直せるところを直すなら pnpm run lint:fix
pnpm format        # フォーマットの確認（vp fmt）。整えるなら pnpm run format:fix
pnpm typecheck     # 型の検査
```

テストでは `describe`・`it`・`expect`・`vi` などを `vitest` ではなく `vite-plus/test` から読み込みます（`vitest` から読み込むとリントで止まります）。

リントは、React Router と wrangler が作る型（`.react-router/types`・`worker-configuration.d.ts`）も読みます。
どちらも `pnpm install` のときに作られます。`pnpm run dev` の間に作り直されるのは `.react-router/types` だけです。
ルートを足したあとに「`./+types/route` が見つからない」と出たときや、`wrangler.jsonc` を変えたときは、`pnpm typecheck` を 1 回動かして作り直してください。

E2E テストは、ユースケース（UC）ごとに画面の主な流れと権限の境目を確かめます。方針は [ADR-007](docs/adr/007-e2e-testing.md) を参照してください。

- 初めて動かす前に、ブラウザを入れておきます: `pnpm exec playwright install chromium`
- E2E はビルド済みのアプリを `http://localhost:4173` で起動し、開発用とは別の DB（`.wrangler/e2e-state`）を毎回作り直して使います。開発サーバーを動かしたままでも実行でき、開発用のデータは消えません。
- 特定の UC だけ動かすときは、タグで絞り込みます: `pnpm exec playwright test --grep @UC-002`（ビルド済みの場合）
- 落ちたテストの操作の記録は `pnpm exec playwright show-report` で見られます。

## 環境とデプロイ

Cloudflare 上には本番とプレビューの 2 つの環境があり、Worker も D1 データベースも完全に別物です。プレビュー側で DB を壊しても本番には影響しません。

| 環境       | ブランチ             | Worker                  | D1                         | URL                                    |
| ---------- | -------------------- | ----------------------- | -------------------------- | -------------------------------------- |
| 本番       | `main`               | `iclub-reserve`         | `iclub-reserve-db`         | 本番ドメイン                           |
| プレビュー | `develop` とその派生 | `iclub-reserve-preview` | `iclub-reserve-preview-db` | `https://iclub-preview.gdgoc-osaka.jp` |
| ローカル   | —                    | （デプロイしない）      | ローカルの SQLite          | `http://localhost:5173`                |

デプロイは Cloudflare Workers Builds が自動で行うため、通常は手元から実行する必要はありません。

> [!NOTE]
> `develop` の派生ブランチは、Cloudflare の [Worker Previews](https://developers.cloudflare.com/workers/previews/) で `https://<ブランチ名>.iclub-preview.gdgoc-osaka.jp` に公開されます（PR ごとのプレビュー）。
> すべてのプレビューが `iclub-preview.gdgoc-osaka.jp` の配下にあるので、**develop で登録したパスキーがどのブランチでもそのまま使えます**。
> Preview は D1・R2・メールのキューを develop と共有します。予約や招待のメールは、Preview が積んだものを develop の Worker が送ります（Preview ではキューの受け取りと Cron が動かないため）。
> 詳しくは [ADR-006](docs/adr/006-preview-environments.md) を参照してください。

### `--env` の指定について

このプロジェクトは `@cloudflare/vite-plugin` を使っており、**環境の切り替えはビルド時に決まります**。`wrangler deploy --env production` のように後から `--env` を付けても、ビルド済みの設定が優先されるため切り替わりません。

そのため、環境を指定するときは必ず用意されたスクリプトを使ってください。ビルド時（`CLOUDFLARE_ENV`）とデプロイ時（`--env`）の両方を指定しており、食い違うと wrangler がエラーで止まるようになっています。

```bash
pnpm run deploy
```

```bash
pnpm run deploy:preview
```

派生ブランチの Preview を手元から作るとき（名前は今のブランチ名になる）:

```bash
pnpm run deploy:preview-branch
```

Preview は `develop` の Worker の設定を引き継がず、`wrangler.jsonc` の `env.preview.previews` の設定で動きます。secret も別に管理されるため、新しく作る Preview の初期値として登録しておいてください（すでにある Preview には反映されません）。

```bash
pnpm exec wrangler preview base-config secret put BETTER_AUTH_SECRET --env preview
```

`BETTER_AUTH_URL`（`https://iclub-preview.gdgoc-osaka.jp`）、`DISCORD_OTP_WEBHOOK_URL`、`DISCORD_OTP_THREAD_ID` も同じように登録します。不要になった Preview は `pnpm exec wrangler preview delete --env preview --name <ブランチ名>` で消せます。

### 本番に出す（リリース）

流れは [ADR-017](docs/adr/017-release-flow-and-migrations.md) で決めています。

リリースの手順:

1. GitHub の Actions のタブで「Start Release」を選び、`develop` で「Run workflow」を押して、出す版（`1.0.0-rc.1` や `1.0.0`。先頭に `v` は付けない）を入れます。`release/v<版>` のブランチと `main` 向きの PR ができ、auto-merge が予約されます。
2. PR の Migration Plan のコメントで、本番の D1 に当てるマイグレーションと警告を確かめます。Preview でも動きを確かめます。
3. コードレビューで承認します。
4. Release Approval のジョブで、本番への承認をします（Environment `production` の必須のレビュアーが行います。PR を出した人は承認できません）。承認すると、本番の D1 にマイグレーションが当たり、auto-merge でマージされ、Workers Builds が本番にデプロイします。
5. デプロイが通ると、「After Release」のワークフローが、タグ `v<版>` と GitHub Release を作り、`sync/v<版>` から `develop` 向きの PR を作ります。承認するとマージされます。

注意:

- 版は semver で書きます。正式に出すまでは `1.0.0-rc.1`・`1.0.0-rc.2`…、出した後は `1.0.0`・`1.0.1`… にします。`main` の版より大きくないと、`Version` のチェックが落ちます。
- 承認の後に push したり `main` を取り込んだりしたら、本番への承認をし直します。
- release と hotfix の PR を同時に承認しないでください。

緊急の修正（hotfix）の手順:

1. 「Start Hotfix」を `develop` で動かし、版（`1.0.1` など）を入れます。`main` から `hotfix/v<版>` のブランチができ、版を上げるコミットが積まれます。
2. そのブランチに修正をコミットして push し、`main` 向きの PR を作ります（本文は `.github/pull_request_template.md` に沿います）。`release/**`・`hotfix/**` のブランチに push できるのは、maintain 以上のロールの人だけです。
3. 後はリリースの手順の 2〜5 と同じです。

### マイグレーションの適用

いつ当たるか:

| タイミング                 | 当て方                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `develop` にマージしたとき | Workers Builds が、preview の D1 に当ててからデプロイします（デプロイコマンド `pnpm run db:migrate:preview && npx wrangler deploy --env preview`）。                |
| `main` に出すとき          | 本番への承認（Release Approval）の後、マージの前に、本番の D1 に当てます。                                                                                          |
| ブランチの Preview         | 当てません。preview の D1 を `develop` とすべての Preview が共有しているためです。新しい表や列を使うブランチは、`develop` にマージするまで Preview では動きません。 |

PR のコメント（Migration Plan）:

`develop` 向き・`main` 向きの PR に、相手の D1（`develop` 向きなら preview、`main` 向きなら本番）に当てるマイグレーション・触る表と操作・予行演習の結果を書きます。予行演習で当てるのに失敗したら、チェックが落ちます。行や表が減る・`DROP TABLE`（外部キーで参照している表も）・`DROP COLUMN`・`UPDATE`・`DELETE` は警告として出すだけで、チェックは落としません。行数と行の中身は出しません。

マイグレーションを書くときの決まり:

- ベースのブランチにあるマイグレーションのファイル（当て済みのもの）は、書き換えたり消したりしないでください。直すときは新しいファイルを足します（書き換えると `Migration Plan` が落ちます）。
- 1 つ前の版のコードでも動く形にします。当ててからデプロイが終わるまで、本番では古いコードが新しいスキーマの上で動くためです。列や表を消すなど、古いコードを壊す変更は 2 回のリリースに分けます（先に新しい形を足して出し、古い形を使わなくなってから消す）。
- D1 では外部キーの確認を止められません。表を作り直す（`DROP TABLE` する）と、`ON DELETE CASCADE` で参照している行も消えます（[`drizzle/migrations/0024_fine_celestials.sql`](drizzle/migrations/0024_fine_celestials.sql) の先頭のコメント）。

手元で予行演習を試す:

マイグレーションをコミットしてから、次のコマンドを動かします。`PLAN_SOURCE_SQLITE` には、相手の D1 の代わりに読む SQLite のファイル（たとえばローカルの D1 の `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<ハッシュ>.sqlite`）を渡します。結果は `migration-plan.md` に書かれます。

```bash
PLAN_TARGET=preview BASE_SHA=origin/develop PLAN_SOURCE_SQLITE=<SQLite のファイル> pnpm run release:migration-plan
```

手で当てる（非常時だけ）:

```bash
pnpm run db:migrate:preview
```

```bash
pnpm run db:migrate:prod
```

> [!CAUTION]
> `db:migrate:prod` は本番の D1 を直接書き換えます。本番への承認も、当てたときの記録（ADR-017 決定 6）も通りません。非常時だけ使い、使う前に `pnpm exec wrangler d1 time-travel info iclub-reserve-db --env production` で bookmark を控えてください。

### Workers Builds のビルド変数

Node.js と pnpm のバージョンは、リポジトリの設定で決まります。

- Node.js: `.node-version`
- pnpm: `package.json` の `devEngines.packageManager`。Workers Builds は pnpm を Corepack で動かし、この指定をビルド変数 `PNPM_VERSION` やビルドイメージ既定の版（9 系）より優先します

`wrangler.jsonc` の `vars` はランタイム変数であり、ビルドイメージは参照しません。ビルドログの「Detected the following tools from environment」に出る pnpm の版は Corepack が切り替える前のものなので、実際の版はインストールの出力で確かめてください。

`iclub-reserve` は、`release/*`・`hotfix/*` を本番の設定でビルドし、dry-run で確かめます（ADR-017 決定 4）。本番以外のブランチのビルド変数は、本番のブランチとは別の「プレビューのベース」に置くので、`CLOUDFLARE_ENV=production` をそこにも設定してください。ベースの設定はブランチを最初にビルドしたときに写されるので、後からベースを直しても、すでにあるブランチのビルドには届きません。

### 認証コード（OTP）の届け先

ログイン時の認証コードは、環境によって届け先が変わります。切り替えは `wrangler.jsonc` の `APP_ENV` で決まり、実装は `app/infra/mail/mail-sender-factory.server.ts` にあります。

| 環境       | 届け先                          | 必要な設定                                                         |
| ---------- | ------------------------------- | ------------------------------------------------------------------ |
| ローカル   | 開発サーバーのターミナル        | なし（`.dev.vars` に SMTP の認証情報を入れれば実際にメールを送る） |
| プレビュー | Discord の特定のスレッド        | `DISCORD_OTP_WEBHOOK_URL` と `DISCORD_OTP_THREAD_ID`               |
| 本番       | メール（Oracle Email Delivery） | `SMTP_USER` と `SMTP_PASSWORD`                                     |

プレビューで実メールを送らないのは、認証コードを受け取るために実在のメールアドレスを用意しなくて済むようにするためです。いずれの環境も、必要な設定が無ければターミナル（Workers のログ）への出力にフォールバックするので、設定前でもログインの流れは最後まで試せます。

> [!WARNING]
> プレビューのスレッドを見られる人は、そこに届いた認証コードで**プレビュー環境の任意のアカウントとしてログインできます**。スレッドは必ず限定公開にしてください。
> プレビューの D1 は本番と別物なので、本番のデータには影響しません。

#### プレビュー環境の設定手順

1. 投稿先スレッドの**親チャンネル**でウェブフックを作る（チャンネルの編集 > 連携サービス > ウェブフック > 新しいウェブフック > ウェブフックURLをコピー）
2. 投稿先スレッドを右クリックして「IDをコピー」（先にユーザー設定 > 詳細設定 > 開発者モード を有効にする）
3. 2 つの値を secret として登録する

```bash
pnpm exec wrangler secret put DISCORD_OTP_WEBHOOK_URL --env preview
```

```bash
pnpm exec wrangler secret put DISCORD_OTP_THREAD_ID --env preview
```

ウェブフックの URL は、知っていれば誰でもそのスレッドに投稿できてしまうため `vars` ではなく secret で渡します。スレッドの ID 自体は秘密ではありませんが、プレビューでしか使わない値なので、`vars`（4 か所すべてに書く必要がある）を増やさずに済むよう同じく secret にしています。

手元で Discord への投稿を試したいときは、`wrangler.jsonc` のトップレベルの `APP_ENV` を一時的に `"preview"` に変え、`.dev.vars` に上の 2 つを書いてください（どちらもコミットしないこと）。
