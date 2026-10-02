# ADR-006: ブランチごとのプレビューを Worker Previews とカスタムドメインで配信する

## ステータス

提案 (2026-09-23)

ブランチごとのプレビューでパスキーが使えなかった問題を解決するために決めた。
本番 (`env.production`) の構成とパスキーの設定は変えない。

## コンテキスト

これまで `develop` の派生ブランチは、`iclub-reserve-preview` のエイリアス付き Version URL
(`https://<ブランチ名>-iclub-reserve-preview.gdsc-osaka.workers.dev`) で公開していた。

- パスキーの rpID は `BETTER_AUTH_URL` のホスト名 (`iclub-reserve-preview.gdsc-osaka.workers.dev`) だった。
  ブランチの URL はこのホストの子ではなく兄弟にあたるので、ブラウザがパスキーの登録もログインも拒否していた。
- さらに、passkey プラグインの `origin` を `BETTER_AUTH_URL` の origin に固定していた。仮に rpID が通っても、サーバー側の検証で落ちていた。
- Cloudflare は 2026-09-22 に Worker Previews を公開した。公式の案内は「エイリアス付き Version URL をブランチのプレビューに使っているなら Previews に移行する」というもの。
  Previews ならブランチごとに設定・secret・ログを分けられ、カスタムドメインでも配信できる。

## 決定

### 1. 派生ブランチは `iclub-reserve-preview` の下の Worker Previews にする

`wrangler.jsonc` の `env.preview.previews` に Preview の設定を書き、`wrangler preview --env preview`
(`pnpm run deploy:preview-branch`) でデプロイする。`develop` 本体は今までどおり `wrangler deploy --env preview` でデプロイする。

本番 Worker に Previews を足して 1 つにまとめる案は採らない (決定 4 を参照)。

### 2. プレビュー用のカスタムドメイン `iclub-preview.gdgoc-osaka.jp` で配信し、rpID を共有する

| 対象                   | URL                                                 | パスキーの rpID                |
| ---------------------- | --------------------------------------------------- | ------------------------------ |
| 本番                   | 本番ドメイン (変更なし)                             | 本番ドメイン (変更なし)        |
| `develop`              | `https://iclub-preview.gdgoc-osaka.jp`              | `iclub-preview.gdgoc-osaka.jp` |
| 派生ブランチの Preview | `https://<ブランチ名>.iclub-preview.gdgoc-osaka.jp` | `iclub-preview.gdgoc-osaka.jp` |

- `env.preview.routes` にカスタムドメインを `previews_enabled: true` で付ける。これで `develop` と各 Preview の両方がこのドメインで配信される。
  ワイルドカードの DNS レコードと証明書 (`*.iclub-preview.gdgoc-osaka.jp`) は Cloudflare が作る。
- rpID は、これまでどおり `BETTER_AUTH_URL` のホスト名から決まる。`BETTER_AUTH_URL` を `https://iclub-preview.gdgoc-osaka.jp` にするだけで、全プレビューで共通の rpID になる。
  D1 も共有しているので、`develop` で登録したパスキーがどのブランチでも使える。
- ホスト名はゾーンの頂点のすぐ下 (1 階層) に置く。これより深いと、Preview のホスト名がワイルドカード証明書から外れ、Advanced Certificate Manager が要る場合がある。
- rpID を本番と共有しない。`gdgoc-osaka.jp` を rpID にすると、本番とプレビューで同じパスキーが使えてしまい、環境を分けた意味が薄れる。

### 3. プレビューでは passkey の `origin` を固定せず、trustedOrigins をサブドメインに広げる

- Better Auth の `trustedOrigins` に `https://*.iclub-preview.gdgoc-osaka.jp` を足す (`buildPreviewTrustedOrigins`)。デプロイごとの URL (`<デプロイ ID>-<ブランチ名>.iclub-preview...`) にも一致する。
- passkey プラグインの `origin` は、プレビューのときだけ未指定にする (`toPasskeyOrigin`)。ブランチごとに origin が違い、`origin` はワイルドカードを受け付けないため。
  期待値はリクエストの Origin ヘッダーになるが、その Origin は先に trustedOrigins の検査を通っている。さらにブラウザは rpID の配下の origin にしかパスキーを使わせないので、信頼する範囲は `iclub-preview.gdgoc-osaka.jp` とそのサブドメインに限られる。
- 本番とローカルは、これまでどおり `BETTER_AUTH_URL` の origin に固定する。

### 4. Queue の consumer と Cron は `develop` 本体に残す

Worker Previews では、Queue の consumer と Cron Triggers が Preview を対象にしない。

- `env.preview.previews` には `queues.producers` だけを書き、consumer と `triggers` は書かない。
- Preview が積んだメール (outbox) は、`develop` 本体の consumer と Cron が、共有の D1 から読んで送る。つまり、送る処理は `develop` のコードで動く。
- 認証コード (OTP) は outbox を通らずにその場で送るので、Preview でも Discord に届く。

本番と 1 つの Worker にまとめると、Preview から積んだメールを受け取れるのが本番の Worker だけになる。
本番の D1 と SMTP で処理されてしまうので、この構成は採らない。
Cloudflare が Preview ごとの Queue consumer と Cron に対応したら、見直す余地がある。

### 5. workers.dev では公開しない

`env.preview` の `workers_dev` と `preview_urls` を `false` にする。
workers.dev の URL は rpID の配下にないためパスキーが使えず、`BETTER_AUTH_URL` とも違うのでログインも弾かれる。使えない URL を残さないために止める。

### 6. Preview の secret は Base 設定で配る

Preview は `env.preview` の secret を引き継がない。次の secret を
`wrangler preview base-config secret put <名前> --env preview` で登録し、新しい Preview の初期値にする。

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL` (`https://iclub-preview.gdgoc-osaka.jp`)
- `DISCORD_OTP_WEBHOOK_URL`
- `DISCORD_OTP_THREAD_ID`

Base を変えても、すでにある Preview には反映されない。

## 移行の手順 (Cloudflare 側)

1. Workers Builds (`iclub-reserve-preview`) を Worker Previews に移行する (既存の Worker は一度だけ設定が要る)。非本番ブランチのデプロイコマンドを `pnpm run deploy:preview-branch` にする。
2. `develop` 本体の `BETTER_AUTH_URL` を `https://iclub-preview.gdgoc-osaka.jp` に変える (`wrangler secret put BETTER_AUTH_URL --env preview`)。
3. 決定 6 の Base secret を登録する。
4. `develop` をデプロイしてカスタムドメインを付け、証明書の発行を待つ。

## トレードオフ

- rpID が変わるので、これまでプレビューで登録したパスキーは使えなくなる。登録し直す必要がある。本番のパスキーには影響しない。
- 招待メールのリンクは、Preview から送っても `BETTER_AUTH_URL` (`develop` の URL) を指す。
- Preview のメールは `develop` のコードで送られる。メール送信の処理そのものを変えるブランチは、マージして `develop` に入るまで Preview で確かめられない。
- Preview URL は既定で誰でも開ける。必要になったら Cloudflare Access を足す。
- Preview は Worker あたり 100 個 (Free プラン) まで。超えると、いちばん長くデプロイされていないものから自動で消える。

## 関連

- ADR-002 (メールの outbox): Queue の consumer と Cron による配送
- [Worker Previews](https://developers.cloudflare.com/workers/previews/)
- [Custom domains (Previews)](https://developers.cloudflare.com/workers/previews/custom-domains/)
- [Resources and isolation (Previews)](https://developers.cloudflare.com/workers/previews/resources/)
