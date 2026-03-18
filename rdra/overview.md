---
type: rdra-overview
project: "iclub-reserve"
actors:
  - id: "ACTOR-001"
    name: "事務局"
    type: human
    description: "Innovators' Club事務局。予約の承認・却下・管理、団体・施設の管理を担う。全予約を承認フローなしで直接作成・変更・削除できる。"
  - id: "ACTOR-002"
    name: "団体"
    type: human
    description: "施設予約を申請する学内の学生団体（i-Squad含む）。osaka-u.ac.jpドメインのメールアドレスを持つ学内ユーザーが構成する。"
  - id: "ACTOR-003"
    name: "Google Calendar"
    type: system
    description: "予約状況を一般公開するカレンダー。承認済み予約を自動反映する。"

goals:
  - id: "GOAL-001"
    name: "団体アカウントによる予約管理"
    description: "団体アカウントで予約を管理し、誰がいつ利用したかを記録する。"
    actors: ["ACTOR-001", "ACTOR-002"]
  - id: "GOAL-006"
    name: "阪大関係者のみに利用を限定する"
    description: "大阪大学のメールアドレス（osaka-u.ac.jpドメイン・サブドメイン含む）を持つ関係者のみがシステムを利用できる。将来的に大学SSOとの連携を想定。"
    actors: ["ACTOR-001", "ACTOR-002"]
  - id: "GOAL-002"
    name: "承認制による優先順位の制御"
    description: "承認制により施設利用の優先順位を事務局が制御できる。"
    actors: ["ACTOR-001"]
  - id: "GOAL-003"
    name: "通知の自動化"
    description: "申請・承認の通知を自動化し、双方の手間を削減する。"
    actors: ["ACTOR-001", "ACTOR-002"]
  - id: "GOAL-004"
    name: "Google Calendarへの自動反映"
    description: "予約状況をGoogle Calendarに自動反映し、外部への情報公開を維持する。"
    actors: ["ACTOR-001", "ACTOR-002", "ACTOR-003"]
  - id: "GOAL-005"
    name: "予約単位のコミュニケーション"
    description: "予約単位で事務局と団体がメッセージをやり取りでき、解錠手続きなどの調整を一元化できる。"
    actors: ["ACTOR-001", "ACTOR-002"]

contexts:
  - id: "BIZ-001"
    name: "reservation-application"
    display_name: "予約申請"
    description: "団体による施設・設備の空き確認、仮予約申請・取り消し・キャンセル・変更。"
    primary_actors: ["ACTOR-002"]
    goals: ["GOAL-001", "GOAL-002", "GOAL-003", "GOAL-005"]
  - id: "BIZ-002"
    name: "reservation-approval"
    display_name: "予約承認"
    description: "事務局による仮予約の承認・却下、直接予約の作成・変更・削除、メッセージ送受信。"
    primary_actors: ["ACTOR-001"]
    goals: ["GOAL-001", "GOAL-002", "GOAL-003", "GOAL-005"]
  - id: "BIZ-003"
    name: "group-management"
    display_name: "団体管理"
    description: "団体アカウントの作成、メンバー・オーナー管理、団体情報の編集、事務局による無効化。"
    primary_actors: ["ACTOR-001", "ACTOR-002"]
    goals: ["GOAL-001"]
  - id: "BIZ-004"
    name: "facility-management"
    display_name: "施設管理"
    description: "事務局による施設・設備の登録・編集・有効化/無効化。"
    primary_actors: ["ACTOR-001"]
    goals: ["GOAL-001", "GOAL-002"]
  - id: "BIZ-005"
    name: "calendar-integration"
    display_name: "カレンダー連携"
    description: "承認済み予約のGoogle Calendarへの自動登録・更新・削除。団体・事務局へのカレンダー購読URL公開を含む。"
    primary_actors: ["ACTOR-001", "ACTOR-002", "ACTOR-003"]
    goals: ["GOAL-004"]
  - id: "BIZ-006"
    name: "user-authentication"
    display_name: "ユーザー認証"
    description: "阪大関係者のみに利用を限定するアカウント登録（メール認証コード）・ログイン。将来的にSSO連携を想定。"
    primary_actors: ["ACTOR-001", "ACTOR-002"]
    goals: ["GOAL-006"]
---

# iclub-reserve 全体概観

Innovators' Club が管理する施設の予約を団体アカウントで管理し、事務局による承認制で運用するシステム。

## システムコンテキスト図

```mermaid
graph TB
    actor1["ACTOR-001: 事務局"]
    actor2["ACTOR-002: 団体"]
    ext1["ACTOR-003: Google Calendar"]
    system["iclub-reserve"]

    actor1 --> system
    actor2 --> system
    system <--> ext1
```

## コンテキスト間関係図

```mermaid
graph LR
    BIZ001["BIZ-001: 予約申請"]
    BIZ002["BIZ-002: 予約承認"]
    BIZ003["BIZ-003: 団体管理"]
    BIZ004["BIZ-004: 施設管理"]
    BIZ005["BIZ-005: カレンダー連携"]
    BIZ006["BIZ-006: ユーザー認証"]

    BIZ001 --> BIZ002
    BIZ002 --> BIZ005
    BIZ003 --> BIZ001
    BIZ004 --> BIZ001
    BIZ006 --> BIZ001
    BIZ006 --> BIZ002
    BIZ006 --> BIZ003
    BIZ006 --> BIZ004
    BIZ006 --> BIZ005
```
