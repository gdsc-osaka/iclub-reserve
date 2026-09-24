---
type: rdra-overview
project: "iclub-reserve"
actors:
  - id: "ACTOR-001"
    name: "事務局"
    type: human
    description: "Innovators' Club事務局。予約の承認・却下・管理、団体・施設の管理を担う。全予約を承認フローなしで直接作成・変更できる（削除はしない）。事務局権限の付与・剥奪と、操作履歴の確認も担う。"
  - id: "ACTOR-002"
    name: "団体"
    type: human
    description: "施設予約を申請する学内の学生団体（i-Squad含む）。osaka-u.ac.jpドメインのメールアドレスを持つ学内ユーザーが構成する。"
  - id: "ACTOR-003"
    name: "Google Calendar"
    type: system
    description: "施設の利用状況を一般公開するカレンダー。承認済み予約の施設名と日時のみを自動反映する。"

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
    description: "予約状況をGoogle Calendarに自動反映し、施設がいつ埋まっているかを外部からも分かるようにする。公開するのは施設名と日時のみで、どの団体が使うかは載せない（COND-008）。"
    actors: ["ACTOR-001", "ACTOR-002", "ACTOR-003"]
  - id: "GOAL-005"
    name: "予約単位のコミュニケーション"
    description: "予約単位で事務局と団体がメッセージをやり取りでき、解錠手続きなどの調整を一元化できる。"
    actors: ["ACTOR-001", "ACTOR-002"]
  - id: "GOAL-007"
    name: "操作の追跡"
    description: "予約・団体（メンバー・招待を含む）・施設・事務局権限への操作について、誰が・いつ・何を・どう変えたかを後から確かめられる。事務局は全件を、団体は自団体に関わる分を見られる。GOAL-001 の「誰がいつ利用したか」が利用の記録であるのに対し、こちらは操作の記録である。ログイン・メールアドレスや氏名の変更・パスキーの管理などの認証・アカウントまわりの記録（不正利用の調査）は対象外とするが、事務局権限の付与・剥奪は対象に含む。"
    actors: ["ACTOR-001", "ACTOR-002"]

contexts:
  - id: "BIZ-001"
    name: "reservation-application"
    display_name: "予約申請"
    description: "団体による施設・設備の空き確認、仮予約申請・取り消し・キャンセル・変更、自団体の予約の一覧と予約の詳細の確認。"
    primary_actors: ["ACTOR-002"]
    goals: ["GOAL-001", "GOAL-002", "GOAL-003", "GOAL-005"]
  - id: "BIZ-002"
    name: "reservation-approval"
    display_name: "予約承認"
    description: "事務局による全団体の予約の一覧確認、仮予約の承認・却下、直接予約の作成・変更、メッセージ送受信。"
    primary_actors: ["ACTOR-001"]
    goals: ["GOAL-001", "GOAL-002", "GOAL-003", "GOAL-005", "GOAL-007"]
  - id: "BIZ-003"
    name: "group-management"
    display_name: "団体管理"
    description: "団体アカウントの作成、所属団体の確認、招待によるメンバー管理、管理者の昇格・降格、団体情報の編集、事務局による有効化・無効化。"
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
    display_name: "ユーザー認証・権限"
    description: "阪大関係者のみに利用を限定するアカウント登録（メール認証コード）と、認証コード・パスキーによるログイン・ログアウト。パスワードは扱わない。将来的にSSO連携を想定。利用者自身が氏名・メールアドレス・パスキー・ログイン中の端末を管理するアカウント設定と、事務局による事務局権限の付与（招待と承諾）・剥奪を含む。"
    primary_actors: ["ACTOR-001", "ACTOR-002"]
    goals: ["GOAL-006", "GOAL-001", "GOAL-002", "GOAL-007"]
  - id: "BIZ-007"
    name: "audit-log"
    display_name: "操作履歴"
    description: "予約・団体・メンバーシップ・招待・施設・事務局権限への変更の記録と、その閲覧。記録は各コンテキストの操作が業務データと同時に書き込み、本コンテキストは事務局（全件）と団体（自団体分）による閲覧を担う。"
    primary_actors: ["ACTOR-001", "ACTOR-002"]
    goals: ["GOAL-007"]
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
    BIZ006["BIZ-006: ユーザー認証・権限"]
    BIZ007["BIZ-007: 操作履歴"]

    BIZ001 --> BIZ002
    BIZ002 --> BIZ005
    BIZ003 --> BIZ001
    BIZ004 --> BIZ001
    BIZ006 --> BIZ001
    BIZ006 --> BIZ002
    BIZ006 --> BIZ003
    BIZ006 --> BIZ004
    BIZ006 --> BIZ005
    BIZ006 --> BIZ007
    BIZ001 -. 記録 .-> BIZ007
    BIZ002 -. 記録 .-> BIZ007
    BIZ003 -. 記録 .-> BIZ007
    BIZ004 -. 記録 .-> BIZ007
    BIZ006 -. 記録 .-> BIZ007
```

点線は、各コンテキストの操作が操作履歴（INFO-008）に記録されることを表す（COND-013）。
