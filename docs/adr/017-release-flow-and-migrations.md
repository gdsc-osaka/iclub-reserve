# ADR-017: ブランチとリリースの流れを決め、本番のマイグレーションは承認してから当てる

## ステータス

承認 (2026-11-10)

## コンテキスト

1. 本番にはまだ出していない。`main` は初期の PR（#2）の時点のままで、`develop` だけが進んでいる。最初は RC（`1.0.0-rc.1` など）として本番に出し、正式に出した後は `1.0.0` の形にする。
2. 本番の D1 へのマイグレーションは、内容を確かめながら人が手で当てることにしていた（[README の「マイグレーションの適用」](../../README.md#マイグレーションの適用)）。当て忘れると、新しい表や列を使う機能が本番で動かなくなる。
3. デプロイは Cloudflare の Workers Builds で行っている。`iclub-reserve`（本番）は `main` を、`iclub-reserve-preview` は `develop` とその派生ブランチを扱う（[ADR-006](./006-preview-environments.md)）。両方の Worker で本番以外のブランチのビルドを有効にすると、1 つのブランチが 2 回ビルドされ、Preview も 2 つできる。
4. CI（[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)）は、`develop` 向きの PR と `develop` への push でしか動かない。`main` 向きの PR では、`main` の Ruleset が必須にしているチェックが報告されない。
5. `package.json` に `version` が無い。タグも GitHub Release もまだ無い。
6. リポジトリは公開である。PR のコメントも Actions のログも誰でも読める。

## 決定

### 1. ブランチは 4 種類にし、マージは merge commit だけにする

| ブランチ                        | 切る元    | PR の向き | 使い道                                        |
| ------------------------------- | --------- | --------- | --------------------------------------------- |
| 機能のブランチ（`feat/*` など） | `develop` | `develop` | 機能の追加・修正                              |
| `release/v<版>`                 | `develop` | `main`    | 本番に出す                                    |
| `hotfix/v<版>`                  | `main`    | `main`    | 本番の緊急の修正                              |
| `sync/v<版>`                    | `main`    | `develop` | 本番に出したものを `develop` に戻す（決定 9） |

- `develop`・`main` の Ruleset とも、マージの方法は merge commit だけにする（設定済み）。squash すると `main` のコミットが `develop` の祖先にならず、次の release の PR に、出したはずの差分がまた並ぶためである。
- `main` の Ruleset は、PR のブランチが最新の `main` を含むことを求めている。release の PR を出している間に hotfix を `main` に入れたら、release の PR で「Update branch」を押して取り込めば済む。
- `main` にマージした後に、`main` で CI を回し直すことはしない。最新の `main` を含むことと merge commit を Ruleset が求めるので、マージした後の `main` のツリーは、PR で確かめたものと同じになるためである。

### 2. 版は `package.json` の `version` を正とする

- `package.json` に `version` を足す。タグ・GitHub Release・ブランチ名は、この版に合わせる。タグは `v<版>` とする。
- 版は semver で書く。正式に出すまでは `1.0.0-rc.1`・`1.0.0-rc.2`…、出した後は `1.0.0`・`1.0.1`… とする。semver の順では `1.0.0-rc.1 < 1.0.0-rc.2 < 1.0.0` なので、RC から正式な版に移っても同じ検査が使える。
- 版を上げるのは `release/*`・`hotfix/*` だけで、`develop` では上げない。戻しの PR（決定 9）で `develop` にも入るので、`develop` の `version` は「最後に出した版」になる。
- `main` 向きの PR に、次を確かめるチェック（`Version`）を置き、`main` の Ruleset で必須にする。
  - `version` が semver の形であること
  - ベースの `main` の `package.json` の版より大きいこと（`main` に `version` が無ければ `0.0.0` とみなす）。タグと比べないのは、最初のリリースの前でも使え、単純なためである
  - タグ `v<版>` がまだ無いこと
  - ブランチ名が `release/v<版>` か `hotfix/v<版>` であること

### 3. いつ・どの版で出すかは人が決め、ブランチと PR は Actions が作る

- push や定期の実行で、release のブランチを自動で切ることはしない。いつ出すか・どの版にするかは人が決めることだからである。手作業の部分だけを `workflow_dispatch` のワークフローにする。
- リリースの開始は「リリースを始める」ワークフロー（`Start Release`。[`.github/workflows/start-release.yml`](../../.github/workflows/start-release.yml)、入力は版）で行う。版を検査し（決定 2 と同じ検査）、`develop` の先頭から `release/v<版>` を作り、`version` を上げるコミットを積み、`main` 向きの PR を作る。PR の本文は [`.github/pull_request_template.md`](../../.github/pull_request_template.md) に沿い、前のタグより後にマージした PR を並べる。
- 緊急の修正の開始は「hotfix を始める」ワークフロー（`Start Hotfix`。[`.github/workflows/start-hotfix.yml`](../../.github/workflows/start-hotfix.yml)、入力は版）で行う。`main` から `hotfix/v<版>` を作り、`version` を上げるコミットを積む。修正のコミットと PR は人が作る。
- ブランチ・コミット・PR は、GitHub App のトークン（`actions/create-github-app-token`）で作る。`GITHUB_TOKEN` で push したブランチや作った PR では Actions のワークフローが起動せず、必須のチェックが報告されないためである。
- GitHub App の鍵（secret `RELEASE_BOT_PRIVATE_KEY`）と Client ID（変数 `RELEASE_BOT_CLIENT_ID`）は、Environment `release-bot` に置き、対象のブランチを `develop` に絞る。ほかのブランチで書き換えたワークフローに、鍵を渡さないためである。`workflow_dispatch` と `check_run` の実行は、どちらも `develop` で動く。
- Ruleset `release` は、`release/**`・`hotfix/**` のブランチを作る・更新する操作を、maintain・admin のロールに限っている。GitHub App をこの Ruleset のバイパスに足す。
- 版を上げるコミットを API で作ってから、そのコミットを指すブランチを作る。ブランチを先に作ると、Workers Builds が版を上げる前のコミットもビルドするためである。
- Bot が作った PR は、作った直後に `gh pr merge --auto --merge` で auto-merge を予約する（リポジトリの「Allow auto-merge」は有効にした）。予約しても、レビューの承認・必須のチェック・本番への承認（決定 5）がそろうまではマージされない。

### 4. Workers Builds は、Worker ごとにビルドするブランチを分ける

| ブランチ                | `iclub-reserve`                                                | `iclub-reserve-preview`                        |
| ----------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| `main`                  | 本番にデプロイ                                                 | ビルドしない                                   |
| `develop`               | ビルドしない                                                   | マイグレーションを当ててからデプロイ（決定 7） |
| `release/*`・`hotfix/*` | 本番の設定でビルドし、dry-run で確かめる（アップロードしない） | Preview                                        |
| そのほか                | ビルドしない                                                   | Preview                                        |

- `iclub-reserve` は、本番のブランチの `main` に加えて、`release/*`・`hotfix/*` もビルドする。対象のブランチは、Workers Builds の API のトリガーの `branch_includes` で指定する。
- `release/*`・`hotfix/*` のビルドでは、本番以外のブランチのデプロイコマンドを `npx wrangler versions upload --dry-run --env production` にする。本番の設定でビルドし、検査だけを行い、アップロードはしない。本番の Worker には、PR のコードのバージョンも Preview も作られない。
- こうするのは、本番の設定（`CLOUDFLARE_ENV=production`）でビルドできるかを、マージの前に確かめるためである。Workers Builds で確かめるので、本番と同じビルドの環境（ビルドの変数・Node.js と pnpm の版）で確かめられる。
- 本番以外のブランチのビルドの変数は、本番のブランチのものとは別に持つ（ダッシュボードの「プレビューのベース」）。本番のブランチと同じ変数（`CLOUDFLARE_ENV=production`・`PNPM_VERSION` など）を、そこにも置く。ベースの設定はブランチを最初にビルドしたときに写されるので、後からベースを直しても、すでにあるブランチのビルドには届かない。
- `iclub-reserve-preview` は、本番以外のブランチのビルドを「`main` を除くすべて」にする。除くブランチは、Workers Builds の API のトリガーの `branch_excludes` で指定する。ダッシュボードでは、本番以外のブランチをビルドするかどうかしか切り替えられないためである。
- `release/*`・`hotfix/*` の Preview を本番の Worker で出さない理由は次の 3 つである。
  - 本番への承認（決定 5）の前は、本番の D1 にマイグレーションが当たっていない。新しい表や列を使う機能は、本番側の Preview では動かない。承認すると auto-merge ですぐにマージされるので、本番側の Preview で確かめる時間はほとんど無い。preview の D1 なら、`develop` にマージした時点で当たっている。
  - 本番の Worker は `preview_urls: false` にしている（レビュー前のコードが本番の Worker 名で公開される事故を防ぐため。[`wrangler.jsonc`](../../wrangler.jsonc) のコメント）。Preview でログインできるようにするには、本番のドメインでも Preview を配信し、trustedOrigins をサブドメインに広げ、パスキーの origin の固定を外すことになる（[ADR-006](./006-preview-environments.md) の決定 2・3）。本番の認証が緩む。
  - 本番側の Preview で試すと、本物のデータが書き換わり、本物の利用者にメールが届く。
- `hotfix/*` の Preview では、`main` のコードが `develop` のスキーマの上で動く。決定 6 の決まり（1 つ前の版のコードでも動く形にする）を守っていれば動く。
- `main` の Ruleset では、`Workers Builds: iclub-reserve`（本番の設定での dry-run）と `Workers Builds: iclub-reserve-preview`（Preview のビルド）の両方を必須にする。

### 5. `main` 向きの PR では、毎回「本番への承認」を通す

- `main` 向きの PR でだけ動く承認のジョブ（`Release Approval`）を置き、GitHub の Environment（`production`）を付ける。ジョブは `Version`・`Migration Plan` と同じワークフロー（[`.github/workflows/release-gate.yml`](../../.github/workflows/release-gate.yml)）に置き、その 2 つが通ってから承認の待ちになる。
- Environment には必須のレビュアー（リリースの担当）を置き、PR を出した人が自分で承認できないようにする（prevent self-review）。公開リポジトリなので、GitHub Free でも使える。
- 承認されるまでジョブは待ち（Waiting）になり、チェックは実行中のまま残るのでマージできない。このジョブを `main` の Ruleset で必須にする。
- 承認されたら、本番の D1 に未適用のマイグレーションがあれば当て（決定 6）、ジョブを通す。auto-merge を予約していれば、そのままマージされ、Workers Builds が本番にデプロイする。
- マイグレーションが無くても、承認は省かない。省くと、コードレビューの承認がそのまま本番に出す操作になり、中身を確かめたつもりで承認した時点で本番に出てしまうためである。コードレビューの承認は「中身の確認」、本番への承認は「本番に出す判断」と、役割を分ける。
- 承認は、その実行のコミットに結び付く。承認の後に push したり `main` を取り込んだりしたら、承認し直す。
- 本番の D1 を編集できる Cloudflare の API トークン（D1 Edit）は、この Environment の secret（`CLOUDFLARE_D1_MIGRATE_TOKEN`）に置く。承認されるまで、ジョブには渡らない。渡すのも D1 を触る手順だけにし、依存を入れる手順などには渡さない。
- Environment は `deployment: false` で使う。デプロイはしないので、Environment のデプロイの記録を作らない。
- Environment の対象のブランチでは、`release/*`・`hotfix/*` に絞れない。`pull_request` で動いたジョブは、`refs/pull/<番号>/merge` で判定されるためである。対象のブランチは `refs/pull/*/merge` にする（`main`・`release/*` などを並べると、このジョブが弾かれる）。`release/*`・`hotfix/*` に絞るのは `Version` のチェックが行う。
- フォークからの PR でも、ジョブを飛ばさずに最初の手順で止める。飛ばすと、必須のチェックが通った扱いになるためである。フォークの PR には secret も渡らない。

### 6. 本番のマイグレーションは、承認の後・マージの前に当てる

- 順番は「承認 → マイグレーション → マージ → デプロイ」にする。マージより先に当てるので、Workers Builds でデプロイしても、デプロイの前にマイグレーションが当たっている。
- 当てる前に `wrangler d1 time-travel info` で D1 の bookmark を取り、ログに残す。失敗したときや壊したときは、Time Travel でその時点に戻す（戻せるのは、Workers Free なら 7 日、Workers Paid なら 30 日前まで）。
- 当てるジョブは PR ごとに 1 つだけ動かし（concurrency）、push したら前の実行を取り消す。承認の待ちも取り消されるので、承認し直す（決定 5）。
- release と hotfix の PR をまたいでは、1 つずつにしない。承認を待っているジョブが concurrency の枠を握ったままになるかが GitHub の文書では分からず、握るなら、release の PR が承認を待っている間、hotfix の PR の承認の待ちが始まらないためである。release と hotfix の PR を同時に承認しないことは、運用で守る。
- 取り消しが、本番の D1 に当てている途中に重なることもある。wrangler は 1 つのファイルの SQL と適用の記録（`d1_migrations` への INSERT）を 1 つのクエリで送る。ローカルの D1 では、1 つのクエリの途中で落ちると前の文も残らないことを確かめた。そのため、ファイルの途中まで当たった状態は残らず、残りのファイルは次の承認で当たる。
- wrangler は、適用済みかどうかをファイル名でしか見ない。本番に当て済みのマイグレーションのファイル（`main` にあるものと、その PR で当てたもの）を書き換えたら、`Migration Plan`（決定 8）を失敗にする。`main` にあるものは `main` と、その PR で当てたものは当てたときのコミットと、中身を比べる。
- 当てたときの中身は、`Release Approval` が PR のコメントに残す。当てたファイルの名前と中身の SHA-256 を、コメントの中の `<!-- migration-applied … -->` に書き、戻すときの bookmark と一緒に人にも見せる。`Migration Plan` はこれと比べる。PR には誰でもコメントできるので、github-actions のコメントだけを読む。
- 当ててからデプロイが終わるまで、本番では古いコードが新しいスキーマの上で動く。また、Workers をロールバックしても D1 は戻らない。そのため、マイグレーションは 1 つ前の版のコードでも動く形にする。列や表を消すなど、古いコードを壊す変更は 2 回のリリースに分ける（expand → contract。先に新しい形を足して出し、古い形を使わなくなってから消す）。

### 7. `develop` 向きの PR では当てず、`develop` にマージしたときに当てる

- `develop` 向きの PR は同時に何本も出るので、PR の中ではマイグレーションを当てない。
- `iclub-reserve-preview` の Workers Builds で、本番のブランチ（`develop`）のデプロイコマンドを `pnpm run db:migrate:preview && npx wrangler deploy --env preview` にする。当ててからデプロイする順が守られる。プレビューなので、デプロイの間に少し動かない時間があってもよい。
- Workers Builds が自動で作るトークンには D1 の権限が無い（Account Settings の読み取りと、Workers Scripts・KV・R2 の編集だけ）。D1 の編集を足したトークンを作り、`iclub-reserve-preview` のビルドに設定する。
- ブランチの Preview ではマイグレーションを当てない。preview の D1 は、`develop` とすべての Preview が共有しているためである（[ADR-006](./006-preview-environments.md)）。新しい表や列を使うブランチは、`develop` にマージするまで Preview では動かない。E2E は CI のローカルの D1 で動くので、影響しない。

### 8. PR にマイグレーションの概要をコメントする

- `main` 向き・`develop` 向きの両方の PR で、マイグレーションの概要を 1 つのコメントに書き、push のたびに同じコメントを書き直す（`Migration Plan` のジョブ）。
- 比べる相手は、`main` 向きなら本番の D1（`iclub-reserve-db`）、`develop` 向きなら preview の D1（`iclub-reserve-preview-db`）とする。

| 項目                   | 中身                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| 当てるマイグレーション | 相手の D1 に未適用のもの（wrangler が適用済みのものを記録する `d1_migrations` の表に無いもの）と、その SQL |
| 触る表と操作           | SQL を `--> statement-breakpoint` で区切り、表ごとに CREATE・ALTER・DROP・UPDATE・DELETE などを並べる      |
| 予行演習の結果         | 相手の D1 を SELECT で読んでランナーのローカルの D1 に写し、未適用のものを当てた結果                       |

- 相手の D1 は、D1 Read のトークン（リポジトリの secret `CLOUDFLARE_D1_READ_TOKEN`）で、SELECT だけで読む。表の定義（`sqlite_master`）と各表の行を読み、ランナーのローカルの D1 に組み立て直してから、`wrangler d1 migrations apply --local` で当てる。
- D1 の書き出し（`wrangler d1 export`）は使わない。書き出しには D1 Edit が要るようで、D1 Read のトークンでは 401 になるという報告が複数ある（Cloudflare の文書には、要る権限が書かれていない）。`Migration Plan` は承認の前に PR のワークフローで動き、PR でワークフローを書き換えればトークンを使える。D1 Edit を渡すと、本番への承認を通さずに本番の D1 を書き換えられてしまう。SELECT で読むので、書き出しと違い、読んでいる間も相手の D1 は止まらない。
- ローカルの D1（miniflare）でも、`PRAGMA foreign_keys=OFF` を付けた `DROP TABLE` で、`ON DELETE CASCADE` の子の行が消えることを確かめた（本番と同じ）。そのため、予行演習で行が減ったことの警告は当てにできる。
- 予行演習で当てるのに失敗したら、チェックを失敗にする。どのファイルで落ちたかと、SQLite のエラーを出す。SQLite のエラーは `UNIQUE constraint failed: user.email` のように表と列の名前だけで、値は含まない。
- 次のものは、警告としてコメントに出すだけにし、チェックは失敗にしない。読んで判断するのは、本番への承認（決定 5）をする人である。
  - 予行演習で行が減った表・無くなった表（表の名前だけを出す。`RENAME TO` で改名した表は、改名後の表と比べる）
  - `DROP TABLE`（Drizzle の表の作り直しも含む）。その表を外部キーで参照している表があれば、`ON DELETE CASCADE`（行が消える）・`ON DELETE SET NULL`・`ON DELETE SET DEFAULT`（列の値が変わる）ごとに並べる。D1 では外部キーの確認を止められず、参照している行も消えるためである（[`drizzle/migrations/0024_fine_celestials.sql`](../../drizzle/migrations/0024_fine_celestials.sql) のコメント）。
  - `DROP COLUMN`・`UPDATE`・`DELETE`（行が減らなくても、値が消えたり変わったりする）
  - 読み取れなかった文（`WITH` で始まる文など）。SQL を人が確かめる。
- 行が減ったときにチェックを失敗にしないのは、意図して消すマイグレーションのための印や、改名の扱いを、いつも運用で守るのは大変なためである。
- 公開リポジトリなので、行数と行の中身は出さない。読んだ行と行数はスクリプトの中だけで扱い、ログにもコメントにも出さない。写すときのエラーには行の中身が混じることがあるので、エラーの文も出さない。写した D1 は artifact に上げない。
- Dependabot やフォークからの PR には secret が渡らない。`develop` 向きの PR で、マイグレーションのファイルを触っていないものは、Cloudflare に触れずにチェックを通す。`main` 向きの PR は、触っていなくても本番の D1 を読む。`main` に未適用のものが残っていないかも見るためである。
- 概要を作るスクリプトは [`scripts/release/migration-plan.ts`](../../scripts/release/migration-plan.ts)（`pnpm run release:migration-plan`）に置く。相手の D1 の代わりにローカルの SQLite のファイルを読めるので（`PLAN_SOURCE_SQLITE`）、手元でも試せる。
- `Migration Plan` を、`develop`・`main` の両方の Ruleset で必須にする。

### 9. 本番に出せたら、GitHub Release と、`develop` への戻しの PR を作る

- Workers Builds のチェック（`Workers Builds: iclub-reserve`）が `main` で終わったときに動くワークフローを置く（`check_run` の `completed`）。チェックの名前・ブランチ・結果（success）で絞る。`check_run` で動くワークフローは既定のブランチ（`develop`）に置く必要がある。ほかのチェックが終わるたびにも起動して飛ばされるので、Actions の一覧が少し増える。ワークフローは `After Release`（[`.github/workflows/after-release.yml`](../../.github/workflows/after-release.yml)）とする。
- タグ `v<版>` を付け、GitHub Release を作る（`gh release create --generate-notes`）。版に `-` が入っていれば pre-release にする。
- `main` から `sync/v<版>` を作り、`develop` 向きの PR を作って auto-merge を予約する（決定 3）。`develop` の Ruleset は最新の `develop` を含むことを求めるので、衝突しなければ `develop` を取り込んでおく。衝突したら、PR にそう書いて人に任せる。
- やり直しても、同じ版を 2 回出さない。タグ `v<版>` があれば GitHub Release を作らず、`sync/v<版>` の PR があれば PR を作らない。
- 戻しの PR のレビューの承認（1 人）は、人が行う。

## 採らなかった案

- **本番のデプロイを GitHub Actions に移す**: マイグレーション → デプロイ → Release の順を 1 つのワークフローで書けるが、本番も `develop` と同じく Workers Builds でデプロイしたい。マイグレーションをマージの前に当てれば、Workers Builds のままでも順番は守られる。
- **PR のコメントのチェックボックスで当てる**: 書き込みの権限があれば、PR を出した人も含めて誰でも押せる。誰が押したかの確認、チェックの作成と完了、押した後の push、外したとき・2 回押したときの扱いを、すべて自前で書くことになる。Environment の承認なら、承認できる人の指定・自己承認の禁止・記録・コミットとの結び付きが GitHub の機能でそろう。
- **概要のチェックを Neutral にしておき、当てたら Pass にする**: GitHub は、必須のチェックの neutral を「通った」と扱うので、マージを止められない。
- **予行演習で行が減ったらチェックを失敗にする**: 決定 8 のとおり、意図して消すときの印や改名の扱いを、いつも運用で守る必要がある。
- **概要に表ごとの行数を出す**: 公開リポジトリなので、本番の行数（利用者の人数など）が誰にでも読める。
- **`develop` 向きの PR の中でマイグレーションを当てる**: PR が同時に何本も出るので、共有の preview の D1 が、どの PR の形になっているか分からなくなる。
- **予行演習のために D1 を書き出す（`wrangler d1 export`）**: 書き出しには D1 Edit のトークンが要る。承認の前に PR のワークフローで動くので、本番の D1 を書き換えられるトークンを、PR を出せる人なら誰でも使えるようになる。書き出している間は、相手の D1 も止まる。
- **予行演習を、本番のデータを読まずにスキーマだけで行う**: 本番の行を読まずに済むが、行が減ったことや、データによる失敗（`UNIQUE` など）を見つけられない。
- **release と hotfix の PR をまたいで、当てるジョブを 1 つずつにする**: 決定 6 のとおり。
- **`release/*`・`hotfix/*` の Preview を本番の Worker で出す**: 決定 4 のとおり。
- **`iclub-reserve` は `main` だけをビルドする**: 本番の設定でビルドできるかが、マージした後まで分からない。
- **本番の設定でのビルドを、CI のジョブ（`pnpm run build:production`）で確かめる**: CI と Workers Builds では、ビルドの環境（ビルドの変数・Node.js と pnpm の版）が別に決まる。Workers Builds の dry-run なら、本番と同じ環境で確かめられる。
- **release のブランチを自動で切る**: 決定 3 のとおり。

## 影響

- 本番に出すたびに、承認する人が要る。マイグレーションの有無にかかわらず要る。
- 承認してからデプロイが終わるまで、本番では古いコードが新しいスキーマの上で動く。マイグレーションを書く人は、決定 6 の決まり（1 つ前の版のコードでも動く形、壊す変更は 2 回に分ける）を守る必要がある。
- 新しい表や列を使うブランチは、`develop` にマージするまで Preview で動かない（決定 7）。
- `release/*`・`hotfix/*` は、2 つの Worker でビルドされる。`iclub-reserve` のほうは dry-run なので、Preview は 1 つだけできる。
- dry-run は Cloudflare に問い合わせないので、本番の D1・R2・Queue が本当にあるかまでは確かめない。確かめるのは、本番の設定でビルドでき、設定とコードを組み立てられることまでである。
- `main` 向きの PR に未適用のマイグレーションがあると、push のたびに本番の D1 の行をすべて読む（決定 8）。D1 の読み取りの行数に数えられる。
- D1 Read のトークンはリポジトリの secret なので、書き込みの権限がある人は、PR でワークフローを書き換えれば本番の行を読める。D1 の権限はアカウント単位なので、preview の D1 だけに絞ることもできない。
- `iclub-reserve-preview` のビルドのトークンは、D1 を編集できる。D1 の権限はアカウント単位なので、本番の D1 も書き換えられる。今の既定のトークンも、アカウントのすべての Worker を編集できるので、危うさの大きさは今と大きくは変わらない。
- `check_run` のワークフローが、ほかのチェックのたびにも起動する（決定 9）。
- release と hotfix の PR を同時に承認しないことを、運用で守る（決定 6）。

## 残っていること

- `branch_includes` に `release/*` の形のパターンを書けるかを確かめる。
- 本番の Workers Builds のデプロイの前に、「本番に未適用のマイグレーションがあれば止める」確認を足すか決める。Ruleset をバイパスしてマージしたときの保険になるが、本番のビルドのトークンに D1 の読み取りの権限が要る。
- `iclub-reserve-preview` のビルドのトークンが、`develop` のビルドとほかのブランチ（Dependabot のブランチを含む）のビルドで同じものかを確かめる。
- 1 つのクエリの途中で落ちたときに前の文が残らないことを、本番の D1 でも確かめる（決定 6。ローカルの D1 でだけ確かめた）。
- 作業の一覧:
  - Cloudflare: D1 Read のトークン（`Migration Plan` 用）と、D1 Edit のトークン（`Release Approval` 用）を作る。`iclub-reserve` の本番以外のブランチのビルドを `release/*`・`hotfix/*` に絞り（`branch_includes`）、デプロイコマンドを dry-run にし、プレビューのベースにビルドの変数を置く。`iclub-reserve-preview` の `branch_excludes` に `main` を入れる。D1 の編集を足したビルドのトークンを作り、`develop` のデプロイコマンドを変える。
  - GitHub: GitHub App（Contents・Pull requests・Workflows の読み書き）を作ってリポジトリに入れ、Ruleset `release` のバイパスに足す。Environment `release-bot`（対象のブランチは `develop`。変数 `RELEASE_BOT_CLIENT_ID`・secret `RELEASE_BOT_PRIVATE_KEY`）と、Environment `production`（対象のブランチは `refs/pull/*/merge`。必須のレビュアーと自己承認の禁止。secret `CLOUDFLARE_D1_MIGRATE_TOKEN`）を作る。リポジトリの secret に `CLOUDFLARE_ACCOUNT_ID`・`CLOUDFLARE_D1_READ_TOKEN` を置く。`main` の Ruleset の必須のチェックに `Version`・`Migration Plan`・`Release Approval` を足し（`Workers Builds: iclub-reserve` は足した）、`develop` の Ruleset に `Migration Plan` を足す。
  - リポジトリ: 済んだ（`package.json` の `version`、`ci.yml` の `main`、決定 2・3・5・8・9 のワークフローと `scripts/release/`、README の「マイグレーションの適用」）。

## 関連

- [ADR-006](./006-preview-environments.md)（プレビュー環境・Worker Previews）
- [`drizzle/migrations/0024_fine_celestials.sql`](../../drizzle/migrations/0024_fine_celestials.sql)（D1 の `DROP TABLE` と CASCADE）
- [README の「マイグレーションの適用」](../../README.md#マイグレーションの適用)
- [Workers Builds: Build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
- [Workers Builds: API reference](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference)
- [Workers Builds: Configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration)
- [D1: Import and export data](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [D1: Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [GitHub: Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [GitHub: Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
