# iclub-reserve

## 起動方法

```bash
pnpm i
cp .dev.vars.example .dev.vars

# マイグレーション適用（DB が空の場合）
pnpm db:migrate:local

# 施設シードデータ投入
pnpm wrangler d1 execute iclub-reserve-db --local --file app/db/seed.sql

# デモアカウント作成
pnpm db:seed

pnpm dev:wrangler
```

作成されるアカウント:

| 種別 | メールアドレス | パスワード |
| --- | --- | --- |
| 事務局 | staff@osaka-u.ac.jp  | demo1234 |
| 団体A | group1@osaka-u.ac.jp | demo1234 |
| 団体B | group2@osaka-u.ac.jp | demo1234 |

`https://127.0.0.1:8787` として起動するはず。
