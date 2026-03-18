---
type: rdra-context
id: "BIZ-005"
name: "calendar-integration"
display_name: "カレンダー連携"

value:
  goals: ["GOAL-004"]
  requirements:
    - id: "REQ-026"
      description: "施設・設備ごとに専用のGoogle Calendarを作成し公開する（Google Service Account使用）。承認済み予約を自動登録する。公開情報は団体名・施設名・日時のみ。"
      traces_to: ["GOAL-004"]
    - id: "REQ-027"
      description: "承認済み予約がキャンセルされた際（団体・事務局どちらでも）にGoogle Calendarから自動削除する。"
      traces_to: ["GOAL-004"]
    - id: "REQ-028"
      description: "承認済み予約の公開フィールド（施設名・日時）が変更された際にGoogle Calendarを自動更新する。"
      traces_to: ["GOAL-004"]
    - id: "REQ-030"
      description: "施設・設備ごとのカレンダー購読URL（Google Calendar追加用・iCal形式）をログイン済みの団体・事務局に公開する。URLを使えば誰でも自分のカレンダーに追加できる。"
      traces_to: ["GOAL-004"]

environment:
  business_usecases:
    - id: "BUC-017"
      name: "Google Calendarへの自動反映"
      actors: ["ACTOR-003"]
      description: "予約の承認・キャンセル・変更をトリガーに、施設ごとのGoogle Calendarを自動で登録・削除・更新する。"
      traces_to: ["REQ-026", "REQ-027", "REQ-028"]
    - id: "BUC-019"
      name: "カレンダー購読URLの公開"
      actors: ["ACTOR-001", "ACTOR-002"]
      description: "施設・設備ごとのカレンダー購読URLをログイン済みの団体・事務局に公開する。URLを入手した後はそのURLを使って誰でも自分のカレンダーに追加できる。"
      traces_to: ["REQ-030"]

boundary:
  usecases:
    - id: "UC-018"
      name: "カレンダー購読URLを確認する"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-010"]
      events: []
      traces_to: ["BUC-019"]
      description: "ログイン済みの団体・事務局が施設・設備ごとのGoogle Calendar追加URLおよびiCal URLを一覧で確認・コピーできる。"

  screens:
    - id: "SCR-010"
      name: "カレンダー一覧・購読ページ"
      description: "全施設・設備のカレンダー購読URLをまとめて一覧表示する。Google Calendarへの追加ボタンとiCal URLを提供する。ログイン済みの団体・事務局のみ閲覧可能。施設ごとの個別URL管理はSCR-009（施設管理画面）で行う。"
      information: ["INFO-002"]

  events:
    - id: "EVT-009"
      name: "Google Calendar登録"
      trigger: "UC-006（承認時）またはUC-008（事務局直接作成時）"
      description: "承認済み予約を Google Calendar に登録する。公開情報: 団体名・施設名・日時。"
    - id: "EVT-010"
      name: "Google Calendar削除"
      trigger: "UC-004（団体キャンセル）/ UC-007（事務局キャンセル）/ UC-005（施設・日時変更で仮予約に戻る場合）/ UC-008（事務局が承認済み予約を直接削除する場合）"
      description: "承認済み予約がキャンセルまたは仮予約に差し戻された場合に Google Calendar から削除する。"
    - id: "EVT-011"
      name: "Google Calendar更新"
      trigger: "UC-008（事務局が承認済み予約の公開フィールド〈施設名・日時〉を直接変更した場合）"
      description: "承認済みのまま公開フィールドが変更された場合に Google Calendar を更新する。使用人数・備考は非公開のため変更してもEVT-011は発火しない。UC-005（施設・日時変更）は承認済みを仮予約に差し戻してEVT-010（削除）を発火するため、承認済みのままCalendarを更新するEVT-011はトリガーしない。"

system:
  information: ["INFO-001", "INFO-002"]
  states: []
  conditions: []
  variations: []
---

# BIZ-005: カレンダー連携

承認済み予約のGoogle Calendarへの自動登録・更新・削除を担うコンテキスト。

## ビジネスコンテキスト図

```mermaid
graph LR
    actor1["ACTOR-001: 事務局"]
    actor2["ACTOR-002: 団体"]
    system["iclub-reserve"]
    ext["ACTOR-003: Google Calendar"]

    subgraph biz5["BIZ-005: カレンダー連携"]
        buc17["BUC-017: Google Calendarへの自動反映"]
        buc19["BUC-019: カレンダー購読URLの公開"]
    end

    system --> buc17
    buc17 --> ext
    actor1 --> buc19
    actor2 --> buc19
```

## イベントトリガー一覧

```mermaid
graph TB
    uc006["UC-006: 承認"] --> evt009["EVT-009: Google Calendar登録"]
    uc008c["UC-008: 事務局直接作成"] --> evt009
    uc004["UC-004: 団体キャンセル"] --> evt010["EVT-010: Google Calendar削除"]
    uc007["UC-007: 事務局キャンセル"] --> evt010
    uc005["UC-005: 施設・日時変更（仮予約に差し戻し）"] --> evt010
    uc008d["UC-008: 事務局直接削除"] --> evt010
    uc008u["UC-008: 事務局が公開フィールドを直接変更"] --> evt011["EVT-011: Google Calendar更新"]
```
