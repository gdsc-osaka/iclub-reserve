# ADR-001: 認証方式の選択 — Firebase Auth（メール認証コード＋パスワード）

- **ステータス**: Accepted
- **決定日**: 2026-03-18
- **決定者**: GDG on Campus Osaka 開発チーム
- **関連 RDRA**: BIZ-006, REQ-008, REQ-031, REQ-032, REQ-033, COND-004, GOAL-006

---

## コンテキスト

- iclub-reserve の利用者を阪大関係者（osaka-u.ac.jp ドメイン）に限定する必要がある（GOAL-006）
- 大阪大学は Google Workspace を導入しておらず Microsoft Office 環境であるため、`@osaka-u.ac.jp` の Google アカウントは存在しない
- 大阪大学独自の「大阪大学全学IT認証基盤サービス」との SSO 連携は将来の選択肢だが、現時点では連携手順・スケジュールが未確定。まず運用実績を積んでから大学側に打診する方針
- 開発・運用インフラは Google Cloud / Firebase に統一し、GDG on Campus として請求先をまとめたい
- MVP ではパスワードリセット機能はスコープ外（SSO 移行後に再設計する）

## 選択肢

| 案 | 方式 | 採否 |
|----|------|------|
| **A（採用）** | Firebase Auth — Email/Password ＋ メール認証コード | ✅ |
| B | Google OAuth (`@osaka-u.ac.jp`) | ❌ |
| C | SSO（大阪大学全学IT認証基盤サービス）を即時対応 | ❌ |

### 案B を却下した理由

大阪大学は Google Workspace を導入していないため `@osaka-u.ac.jp` の Google アカウントが存在せず、Google OAuth によるドメイン制限が機能しない。

### 案C を却下した理由

大阪大学全学IT認証基盤サービスとの連携手順・サポートプロトコルが現時点で未確定。また、連携には運用実績を積んだうえで大学側と交渉するほうが現実的と判断した。

## 決定

**Firebase Authentication（Email/Password ＋ メール認証コード）を採用する。**

- アカウント登録時に osaka-u.ac.jp ドメインのメールアドレスへ認証コードを送信し、コード入力で本登録を完了する（REQ-031, COND-004）
- 認証基盤として Firebase Auth を使用し、Google Cloud に請求を集約する

## 将来の SSO 移行方針

大阪大学全学IT認証基盤サービスの対応プロトコルに応じて、以下いずれかの方式で移行する。

### パターン1: SAML 2.0 / OIDC 対応の場合

Firebase Auth を **Google Cloud Identity Platform（GCIP）** にアップグレードし、大学の SAML/OIDC エンドポイントをプロバイダとして設定する。アプリ側の認証コードはほぼ変更不要。

### パターン2: 独自プロトコルの場合

**Firebase Custom Token Authentication** を用いてミドルウェアで橋渡しする。

```
ユーザー
  → 大阪大学認証基盤（独自プロトコル）
  → 自前バックエンド（認証結果を検証し Firebase Admin SDK で custom token を生成）
  → Firebase Auth（signInWithCustomToken）
  → iclub-reserve（Firebase JWT で通常通り動作）
```

アプリ本体のコードは変更不要。大学側の認証基盤がどのような形式で認証結果を返すか（リダイレクト・API コール等）は、連携前に大学の IT 部門への確認が必要。

## 影響・トレードオフ

| 項目 | 内容 |
|------|------|
| パスワード管理 | bcrypt 等によるハッシュ化が必要（Firebase Auth が内部で処理） |
| パスワードリセット | MVP スコープ外。SSO 移行後に再設計 |
| SSO 移行コスト | Identity Platform へのアップグレード費用（従量課金）または Custom Token ミドルウェアの実装・維持コストが発生 |
| ドメイン検証 | Firebase Auth の Email/Password では自動的なドメイン制限機能がないため、アプリ側で COND-004 を実装する必要がある |
