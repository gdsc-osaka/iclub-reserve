---
type: rdra-context
id: "BIZ-006"
name: "user-authentication"
display_name: "ユーザー認証"

value:
  goals: ["GOAL-006"]
  requirements:
    - id: "REQ-008"
      description: "登録できるメールアドレスはosaka-u.ac.jpドメイン（サブドメイン含む）のみ。将来的に大学認証システムとの連携を想定。"
      traces_to: ["GOAL-006"]
    - id: "REQ-031"
      description: "アカウント登録時にメールアドレスへ認証コードを送信し、コード入力により本登録を完了する。"
      traces_to: ["GOAL-006"]
    - id: "REQ-032"
      description: "登録済みのメールアドレスとパスワードでログインできる。"
      traces_to: ["GOAL-006"]
    - id: "REQ-033"
      description: "初回アカウント登録時にi-Club利用規約への同意が必要。同意しない場合は登録を完了できない。"
      traces_to: ["GOAL-006"]

environment:
  business_usecases:
    - id: "BUC-020"
      name: "アカウント登録"
      actors: ["ACTOR-002"]
      description: "ユーザーがosaka-u.ac.jpドメインのメールアドレスとパスワードを入力し、利用規約に同意の上、メール認証コードを経て本登録を完了する。"
      traces_to: ["REQ-008", "REQ-031", "REQ-033"]
    - id: "BUC-021"
      name: "ログイン"
      actors: ["ACTOR-001", "ACTOR-002"]
      description: "登録済みユーザーがメールアドレスとパスワードでシステムにログインする。"
      traces_to: ["REQ-032"]

boundary:
  usecases:
    - id: "UC-019"
      name: "アカウントを登録する"
      actors: ["ACTOR-002"]
      screens: ["SCR-011", "SCR-013"]
      events: ["EVT-013"]
      traces_to: ["BUC-020"]
      description: "メールアドレス（osaka-u.ac.jpドメイン）とパスワードを入力し、利用規約に同意の上、送信された認証コードを入力して本登録を完了する。"
    - id: "UC-020"
      name: "ログインする"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-012"]
      events: []
      traces_to: ["BUC-021"]
      description: "登録済みのメールアドレスとパスワードでログインする。"

  screens:
    - id: "SCR-011"
      name: "アカウント登録フォーム"
      description: "メールアドレス（osaka-u.ac.jpドメイン検証）・氏名・パスワードを入力し、i-Club利用規約（リンク表示）への同意チェックボックスにチェックして登録を開始するフォーム。"
      information: ["INFO-006"]
    - id: "SCR-012"
      name: "ログイン画面"
      description: "メールアドレスとパスワードを入力してログインする画面。"
      information: ["INFO-006"]
    - id: "SCR-013"
      name: "認証コード入力画面"
      description: "登録メールアドレスに送信された認証コードを入力して本登録を完了する画面。"
      information: []

  events:
    - id: "EVT-013"
      name: "認証コード送信"
      trigger: "UC-019: アカウント登録開始時"
      description: "入力されたメールアドレスへ認証コードを送信する。"

system:
  information: ["INFO-006"]
  states: []
  conditions:
    - id: "COND-004"
      name: "メールドメイン検証"
      description: "登録するメールアドレスのドメインがosaka-u.ac.jpまたはそのサブドメイン（例: ecs.osaka-u.ac.jp、uic.osaka-u.ac.jp）であること。"
      traces_to: ["UC-019"]
  variations: []
---

# BIZ-006: ユーザー認証

osaka-u.ac.jpドメインのメールアドレスを持つ阪大関係者のみがシステムを利用できるよう、アカウント登録・メール認証・ログインを担うコンテキスト。パスワードリセットは将来のSSO連携を見据えてMVPから除外。

## ビジネスコンテキスト図

```mermaid
graph LR
    actor1["ACTOR-001: 事務局"]
    actor2["ACTOR-002: 団体"]

    subgraph biz6["BIZ-006: ユーザー認証"]
        buc20["BUC-020: アカウント登録"]
        buc21["BUC-021: ログイン"]
    end

    actor2 --> buc20
    actor1 --> buc21
    actor2 --> buc21
```

## 業務フロー

### BUC-020: アカウント登録

```mermaid
sequenceDiagram
    actor ユーザー
    participant システム

    ユーザー->>システム: メールアドレス・氏名・パスワードを入力し利用規約に同意
    システム->>システム: ドメイン検証（osaka-u.ac.jp）（COND-004）
    システム-->>ユーザー: 認証コードをメール送信（EVT-013）
    ユーザー->>システム: 認証コードを入力
    システム-->>ユーザー: 本登録完了
```

### BUC-021: ログイン

```mermaid
sequenceDiagram
    actor ユーザー
    participant システム

    ユーザー->>システム: メールアドレス・パスワードを入力
    システム-->>ユーザー: ログイン完了
```
