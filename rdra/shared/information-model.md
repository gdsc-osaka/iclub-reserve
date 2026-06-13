---
type: rdra-information-model
entities:
  - id: "INFO-001"
    name: "予約"
    description: "施設・設備に対する予約エントリ。ステータスにより provisional（仮予約）・approved（承認済み）・withdrawn（団体取り消し）・rejected（事務局却下）・cancelled（団体キャンセル）・cancelled_by_staff（事務局キャンセル）を区別する。"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "予約ID（主キー）"
      - name: "group_id"
        type: "string"
        required: true
        description: "予約を申請した団体のID（外部キー）"
      - name: "facility_id"
        type: "string"
        required: true
        description: "予約対象の施設・設備ID（外部キー）"
      - name: "start_at"
        type: "datetime"
        required: true
        description: "予約開始日時"
      - name: "end_at"
        type: "datetime"
        required: true
        description: "予約終了日時"
      - name: "headcount"
        type: "integer"
        required: false
        description: "使用人数"
      - name: "note"
        type: "string"
        required: false
        description: "備考"
      - name: "status"
        type: "enum"
        required: true
        description: "予約ステータス: provisional（仮予約）/ approved（承認済み）/ withdrawn（団体による取り消し済み）/ rejected（事務局による却下済み）/ cancelled（団体によるキャンセル済み）/ cancelled_by_staff（事務局によるキャンセル済み）"
      - name: "status_reason"
        type: "string"
        required: false
        description: "却下・キャンセル理由。status が rejected（事務局却下）または cancelled_by_staff（事務局キャンセル）の場合は必須（COND-002）。withdrawn（団体取り消し）・cancelled（団体キャンセル）の場合は任意。"
      - name: "created_by"
        type: "string"
        required: true
        description: "予約作成者のユーザーID"
      - name: "created_at"
        type: "datetime"
        required: true
        description: "作成日時"
      - name: "updated_at"
        type: "datetime"
        required: true
        description: "最終更新日時"
    relations:
      - target: "INFO-002"
        type: "N:1"
        label: "対象施設/設備"
      - target: "INFO-003"
        type: "N:1"
        label: "申請団体"
      - target: "INFO-004"
        type: "1:N"
        label: "メッセージ"
      - target: "INFO-006"
        type: "N:1"
        label: "作成者"
    traces_to:
      [
        "UC-001",
        "UC-002",
        "UC-003",
        "UC-004",
        "UC-005",
        "UC-006",
        "UC-007",
        "UC-008",
        "SCR-001",
        "SCR-002",
        "SCR-003",
        "SCR-005",
      ]

  - id: "INFO-002"
    name: "施設/設備"
    description: "予約可能な施設・設備。部屋と設備の区別は施設名に含め、独立した種別フィールドは持たない。"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "施設/設備ID（主キー）"
      - name: "name"
        type: "string"
        required: true
        description: "施設・設備名称（例: 吹田：C棟2階占有 イベント予約）"
      - name: "description"
        type: "string"
        required: false
        description: "施設・設備の説明"
      - name: "photo_url"
        type: "string"
        required: false
        description: "施設・設備の写真URL"
      - name: "google_calendar_id"
        type: "string"
        required: false
        description: "施設に紐づくGoogle CalendarのID。Service Accountで管理。未設定の場合はカレンダー連携をスキップする。"
      - name: "calendar_url"
        type: "string"
        required: false
        description: "カレンダー購読URL（iCal形式）。google_calendar_id から自動生成。"
      - name: "is_active"
        type: "boolean"
        required: true
        description: "有効/無効フラグ。無効化には将来の予約（仮予約・承認済み）がすべて終了状態（取り消し済み・却下済み・キャンセル済み）であることが必要（COND-003）。"
      - name: "created_at"
        type: "datetime"
        required: true
        description: "作成日時"
      - name: "updated_at"
        type: "datetime"
        required: true
        description: "最終更新日時"
    relations:
      - target: "INFO-001"
        type: "1:N"
        label: "予約"
    traces_to: ["UC-015", "UC-016", "UC-018", "SCR-001", "SCR-009", "SCR-010"]

  - id: "INFO-003"
    name: "団体"
    description: "施設予約を行う学内学生団体。1ユーザーが複数団体に所属できる。"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "団体ID（主キー）"
      - name: "name"
        type: "string"
        required: true
        description: "団体名"
      - name: "is_active"
        type: "boolean"
        required: true
        description: "有効/無効フラグ。事務局のみ変更可能。"
      - name: "created_at"
        type: "datetime"
        required: true
        description: "作成日時"
      - name: "updated_at"
        type: "datetime"
        required: true
        description: "最終更新日時"
    relations:
      - target: "INFO-001"
        type: "1:N"
        label: "予約"
      - target: "INFO-005"
        type: "1:N"
        label: "メンバーシップ"
    traces_to: ["UC-010", "UC-013", "UC-014", "SCR-006", "SCR-007", "SCR-008"]

  - id: "INFO-004"
    name: "メッセージ"
    description: "予約単位での事務局・団体間のメッセージ。他の団体からは閲覧不可。"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "メッセージID（主キー）"
      - name: "reservation_id"
        type: "string"
        required: true
        description: "紐づく予約ID（外部キー）"
      - name: "sender_id"
        type: "string"
        required: true
        description: "送信者のユーザーID"
      - name: "body"
        type: "string"
        required: true
        description: "メッセージ本文"
      - name: "sent_at"
        type: "datetime"
        required: true
        description: "送信日時"
    relations:
      - target: "INFO-001"
        type: "N:1"
        label: "対象予約"
      - target: "INFO-006"
        type: "N:1"
        label: "送信者"
    traces_to: ["UC-009", "SCR-005"]

  - id: "INFO-005"
    name: "メンバーシップ"
    description: "ユーザーと団体の多対多の関係を表す中間テーブル。ロール（オーナー/メンバー）を保持する。"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "メンバーシップID（主キー）"
      - name: "user_id"
        type: "string"
        required: true
        description: "ユーザーID（外部キー）"
      - name: "group_id"
        type: "string"
        required: true
        description: "団体ID（外部キー）"
      - name: "role"
        type: "enum"
        required: true
        description: "ロール: owner（オーナー）/ member（メンバー）"
      - name: "joined_at"
        type: "datetime"
        required: true
        description: "参加日時"
    relations:
      - target: "INFO-006"
        type: "N:1"
        label: "ユーザー"
      - target: "INFO-003"
        type: "N:1"
        label: "団体"
    traces_to: ["UC-011", "UC-012", "SCR-007"]

  - id: "INFO-006"
    name: "ユーザー"
    description: "システムを利用する個人。osaka-u.ac.jpドメイン（サブドメイン含む）のメールアドレスのみ登録可能。"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "ユーザーID（主キー）"
      - name: "email"
        type: "string"
        required: true
        description: "メールアドレス（osaka-u.ac.jpドメイン必須）"
      - name: "name"
        type: "string"
        required: true
        description: "氏名"
      - name: "is_staff"
        type: "boolean"
        required: true
        description: "事務局フラグ。trueの場合は全管理権限を持つ。"
      - name: "created_at"
        type: "datetime"
        required: true
        description: "作成日時"
      - name: "updated_at"
        type: "datetime"
        required: true
        description: "最終更新日時"
    relations:
      - target: "INFO-005"
        type: "1:N"
        label: "メンバーシップ"
      - target: "INFO-004"
        type: "1:N"
        label: "送信メッセージ"
    traces_to:
      [
        "UC-010",
        "UC-011",
        "UC-019",
        "UC-020",
        "SCR-006",
        "SCR-007",
        "SCR-011",
        "SCR-012",
        "SCR-013",
      ]
---

# 情報モデル（横断）

## ER図

```mermaid
erDiagram
    INFO_006 ||--o{ INFO_005 : "所属する"
    INFO_003 ||--o{ INFO_005 : "構成される"
    INFO_003 ||--o{ INFO_001 : "申請する"
    INFO_002 ||--o{ INFO_001 : "予約される"
    INFO_001 ||--o{ INFO_004 : "持つ"
    INFO_006 ||--o{ INFO_004 : "送信する"
    INFO_006 ||--o{ INFO_001 : "作成する"

    INFO_006["INFO-006: ユーザー"] {
        string id PK
        string email
        string name
        boolean is_staff
        datetime created_at
        datetime updated_at
    }
    INFO_003["INFO-003: 団体"] {
        string id PK
        string name
        boolean is_active
        datetime created_at
        datetime updated_at
    }
    INFO_005["INFO-005: メンバーシップ"] {
        string id PK
        string user_id FK
        string group_id FK
        enum role
        datetime joined_at
    }
    INFO_002["INFO-002: 施設/設備"] {
        string id PK
        string name
        string description
        string photo_url
        string google_calendar_id
        string calendar_url
        boolean is_active
        datetime created_at
        datetime updated_at
    }
    INFO_001["INFO-001: 予約"] {
        string id PK
        string group_id FK
        string facility_id FK
        datetime start_at
        datetime end_at
        integer headcount
        string note
        enum status "provisional/approved/withdrawn/rejected/cancelled/cancelled_by_staff"
        string status_reason
        string created_by FK
        datetime created_at
        datetime updated_at
    }
    INFO_004["INFO-004: メッセージ"] {
        string id PK
        string reservation_id FK
        string sender_id FK
        string body
        datetime sent_at
    }
```
