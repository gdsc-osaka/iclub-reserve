---
type: rdra-information-model
entities:
  - id: "INFO-001"
    name: "予約"
    description: "施設・設備に対する予約エントリ。ステータスにより provisional（仮予約）・approved（承認済み）・withdrawn（団体取り消し）・rejected（事務局却下）・cancelled（団体キャンセル）・cancelled_by_staff（事務局キャンセル）を区別する。属性は開示範囲によって3段階に分かれる（COND-008）。"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "予約ID（主キー）"
      - name: "group_id"
        type: "string"
        required: true
        description: "予約を申請した団体のID（外部キー）。開示範囲: 団体名としてログイン済みの全ユーザーへ公開（COND-008）。"
      - name: "facility_id"
        type: "string"
        required: true
        description: "予約対象の施設・設備ID（外部キー）。開示範囲: 未ログインを含む全体へ公開（COND-008）。"
      - name: "start_at"
        type: "datetime"
        required: true
        description: "予約開始日時。開示範囲: 未ログインを含む全体へ公開（COND-008）。"
      - name: "end_at"
        type: "datetime"
        required: true
        description: "予約終了日時。開示範囲: 未ログインを含む全体へ公開（COND-008）。"
      - name: "headcount"
        type: "integer"
        required: true
        description: "使用人数。申請時の必須入力（REQ-002）。開示範囲: 自団体のメンバーと事務局のみ（COND-008）。"
      - name: "note"
        type: "string"
        required: false
        description: "備考。開示範囲: 自団体のメンバーと事務局のみ（COND-008）。"
      - name: "status"
        type: "enum"
        required: true
        description: "予約ステータス: provisional（仮予約）/ approved（承認済み）/ withdrawn（団体による取り消し済み）/ rejected（事務局による却下済み）/ cancelled（団体によるキャンセル済み）/ cancelled_by_staff（事務局によるキャンセル済み）。開示範囲: ログイン済みの全ユーザーへ公開（COND-008）。"
      - name: "status_reason"
        type: "string"
        required: false
        description: "却下・キャンセル理由。status が rejected（事務局却下）または cancelled_by_staff（事務局キャンセル）の場合は必須（COND-002）。withdrawn（団体取り消し）・cancelled（団体キャンセル）の場合は任意。開示範囲: 自団体のメンバーと事務局のみ（COND-008）。"
      - name: "created_by"
        type: "string"
        required: true
        description: "予約作成者のユーザーID（外部キー）。開示範囲: 自団体のメンバーと事務局のみ（COND-008）。"
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
        "UC-032",
        "UC-033",
        "UC-034",
        "SCR-001",
        "SCR-002",
        "SCR-003",
        "SCR-005",
        "SCR-018",
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
        description: "施設・設備の写真URL（R2 に置いた写真の配信 URL。アプリ内の相対パス）"
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
    traces_to:
      [
        "UC-015",
        "UC-016",
        "UC-018",
        "SCR-001",
        "SCR-002",
        "SCR-003",
        "SCR-005",
        "SCR-009",
        "SCR-010",
        "SCR-018",
      ]

  - id: "INFO-003"
    name: "団体"
    description: "施設予約を行う学内学生団体。1ユーザーが複数団体に所属できる。状態は3値で管理し（STATE-002）、削除はせず無効化で運用する。"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "団体ID（主キー）。所属メンバーと事務局にのみ知らせる値。"
      - name: "name"
        type: "string"
        required: true
        description: "団体名"
      - name: "slug"
        type: "string"
        required: true
        description: "団体を指すための短い識別子（一意）。所属していない人の目に触れうる値として扱うため、id と同じ値にしてはならない。"
      - name: "status"
        type: "enum"
        required: true
        description: "団体の状態: pending（承認待ち）/ enabled（有効）/ disabled（無効）。既定は pending。enabled への変更は事務局のみが行う（REQ-021）。pending・disabled の団体では予約を申請できない（COND-006）。"
      - name: "logo"
        type: "string"
        required: false
        description: "団体のロゴURL。現時点では利用していない。"
      - name: "metadata"
        type: "string"
        required: false
        description: "拡張用の予備領域。現時点では利用していない。"
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
      - target: "INFO-007"
        type: "1:N"
        label: "招待"
      - target: "INFO-008"
        type: "1:N"
        label: "操作履歴"
    traces_to:
      [
        "UC-010",
        "UC-013",
        "UC-014",
        "UC-035",
        "SCR-001",
        "SCR-002",
        "SCR-003",
        "SCR-005",
        "SCR-006",
        "SCR-007",
        "SCR-008",
        "SCR-016",
        "SCR-018",
        "SCR-022",
      ]

  - id: "INFO-004"
    name: "メッセージ"
    description: "予約単位での事務局・団体間のメッセージ。自団体のメンバーと事務局のみが閲覧でき、他の団体からは閲覧できない（COND-008）。"
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
      - name: "sent_as_staff"
        type: "boolean"
        required: true
        description: "事務局の横断権限（COND-009）によって初めて許された送信であれば true。送信者がその予約の団体に所属していない事務局である場合にあたる。送信時に固定し、後から所属や事務局権限が変わっても表示は変わらない。団体側の表示で送信者を「事務局」とするかの判定に使う（COND-008）。考え方は INFO-008.acted_as_staff と同じ。"
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
    description: "ユーザーと団体の多対多の関係を表す中間テーブル。ロール（管理者/メンバー）を保持する。"
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
        description: "ロール: admin（管理者）/ member（メンバー）。常に1つだけを持つ（COND-007・VAR-001）。"
      - name: "created_at"
        type: "datetime"
        required: true
        description: "参加日時"
      - name: "updated_at"
        type: "datetime"
        required: true
        description: "最終更新日時"
    relations:
      - target: "INFO-006"
        type: "N:1"
        label: "ユーザー"
      - target: "INFO-003"
        type: "N:1"
        label: "団体"
    traces_to: ["UC-011", "UC-012", "UC-022", "UC-035", "SCR-007", "SCR-008", "SCR-022"]

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
        description: "メールアドレス（一意）。保存する値のドメインは制限しない。osaka-u.ac.jpドメイン（サブドメイン含む）であることを求めるのはアカウント作成時とメールアドレス変更時の入力に対してであり、既存の値やログインには適用しない（COND-004）。"
      - name: "name"
        type: "string"
        required: true
        description: "氏名（本名）。NULLは許さず、未設定は空文字で表す。アカウント作成の直後は空文字であり、初回セットアップ（SCR-014）で登録して本登録が完了する。空白のみの値も未設定として扱う。登録・変更（SCR-021）の入力はCOND-017を満たすこと。"
      - name: "email_verified"
        type: "boolean"
        required: true
        description: "メールアドレスの確認済みフラグ。認証コードによるログインで true になる。"
      - name: "image"
        type: "string"
        required: false
        description: "プロフィール画像URL。現時点では利用していない。"
      - name: "is_staff"
        type: "boolean"
        required: true
        description: "事務局フラグ。trueの場合は所属に関わらず全団体・全予約への権限を持つ（COND-009）。true にするのは事務局招待の承諾（UC-027）、false に戻すのは事務局による剥奪（UC-028）である。最初の1人だけは DB またはシードで設定する。事務局が0人になる変更はできない（COND-014）。"
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
      - target: "INFO-007"
        type: "1:N"
        label: "送信した招待"
      - target: "INFO-008"
        type: "1:N"
        label: "行った操作"
      - target: "INFO-009"
        type: "1:N"
        label: "送信した事務局招待"
      - target: "INFO-010"
        type: "1:N"
        label: "登録したパスキー"
      - target: "INFO-011"
        type: "1:N"
        label: "ログイン中の端末"
    traces_to:
      [
        "UC-010",
        "UC-011",
        "UC-019",
        "UC-020",
        "UC-021",
        "UC-023",
        "UC-026",
        "UC-027",
        "UC-028",
        "UC-029",
        "UC-035",
        "SCR-005",
        "SCR-007",
        "SCR-012",
        "SCR-014",
        "SCR-015",
        "SCR-017",
        "SCR-018",
        "SCR-019",
        "SCR-021",
      ]

  - id: "INFO-007"
    name: "招待"
    description: "団体へのメンバー招待。管理者または事務局が送り、招待された人が承諾するとメンバーシップ（INFO-005）が作られる。"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "招待ID（主キー）"
      - name: "group_id"
        type: "string"
        required: true
        description: "招待元の団体ID（外部キー）"
      - name: "email"
        type: "string"
        required: true
        description: "招待先のメールアドレス"
      - name: "role"
        type: "enum"
        required: false
        description: "承諾後に与えるロール（VAR-001）。未指定の場合は member とする。"
      - name: "status"
        type: "enum"
        required: true
        description: "招待の状態: pending（承諾待ち）/ accepted（承諾済み）/ rejected（辞退）/ canceled（取り消し）。既定は pending。"
      - name: "expires_at"
        type: "datetime"
        required: true
        description: "招待の有効期限。送信から48時間。期限を過ぎた招待は承諾・辞退できない。"
      - name: "inviter_id"
        type: "string"
        required: true
        description: "招待を送ったユーザーのID（外部キー）"
      - name: "created_at"
        type: "datetime"
        required: true
        description: "作成日時"
    relations:
      - target: "INFO-003"
        type: "N:1"
        label: "招待元団体"
      - target: "INFO-006"
        type: "N:1"
        label: "招待者"
    traces_to: ["UC-011", "UC-022", "SCR-007", "SCR-016"]

  - id: "INFO-008"
    name: "操作履歴"
    description: "予約・団体・メンバーシップ・招待・施設・事務局権限に対して人が行った変更の記録。1回の操作につき1件を、業務データの変更と同じ db.batch で追記する（COND-013）。更新・削除はせず、無期限に保持する（REQ-038）。記録対象や操作者が後で削除されても（メンバーシップの削除など）記録は残るよう、他の情報への外部キー制約は張らず、論理的な参照とする。"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "操作履歴ID（主キー）"
      - name: "occurred_at"
        type: "datetime"
        required: true
        description: "操作日時"
      - name: "actor_id"
        type: "string"
        required: true
        description: "操作者のユーザーID。画面には現在の氏名を表示する。"
      - name: "acted_as_staff"
        type: "boolean"
        required: true
        description: "事務局の横断権限（COND-009）によって初めて許された操作であれば true。記録時に固定する。団体側の表示で操作者を「事務局」とするかの判定に使う（COND-012）。"
      - name: "action"
        type: "enum"
        required: true
        description: "操作の種類（VAR-002）"
      - name: "target_type"
        type: "enum"
        required: true
        description: "記録対象の種類（VAR-003）"
      - name: "target_id"
        type: "string"
        required: true
        description: "記録対象のID。事務局権限の記録では、招待・招待の取り消し・辞退は事務局招待のID、承諾・剥奪は対象ユーザーのIDとする（承諾の changes には事務局招待のIDを含める）。これにより、あるユーザーへの付与と剥奪を同じ target_id でたどれる。"
      - name: "group_id"
        type: "string"
        required: false
        description: "記録対象が属する団体のID。予約・団体・メンバーシップ・招待の記録で設定し、施設/設備・事務局権限の記録では空。開示範囲の判定に使う（COND-012）。"
      - name: "changes"
        type: "json"
        required: true
        description: "変更のあった項目ごとの変更前・変更後の値。作成では変更前を空、状態の変更では理由（status_reason）を含める。削除された対象を後から特定できるよう、値が変わらなくても対象を特定する項目（メンバーシップなら user_id、招待なら email と role）を含める。招待先のメールアドレスは承諾されなかった招待でも残す。管理者は招待を送った時点でそのアドレスを知っており、SCR-007 でも開示済みのため、履歴で新たに開示する情報は無い。"
    relations:
      - target: "INFO-006"
        type: "N:1"
        label: "操作者"
      - target: "INFO-003"
        type: "N:1"
        label: "対象の団体"
    traces_to:
      [
        "UC-002",
        "UC-003",
        "UC-004",
        "UC-005",
        "UC-006",
        "UC-007",
        "UC-008",
        "UC-010",
        "UC-011",
        "UC-012",
        "UC-013",
        "UC-014",
        "UC-015",
        "UC-016",
        "UC-017",
        "UC-022",
        "UC-024",
        "UC-025",
        "UC-026",
        "UC-027",
        "UC-028",
        "SCR-005",
        "SCR-007",
        "SCR-018",
      ]

  - id: "INFO-009"
    name: "事務局招待"
    description: "事務局権限への招待。事務局が送り、招待された人が承諾すると INFO-006.is_staff が true になる。団体の招待（INFO-007）とは、団体を持たないこと・与えるものがロールではなく事務局権限であることが異なるため、別の情報として扱う。状態は STATE-003。"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "事務局招待ID（主キー）"
      - name: "email"
        type: "string"
        required: true
        description: "招待先のメールアドレス"
      - name: "status"
        type: "enum"
        required: true
        description: "事務局招待の状態: pending（承諾待ち）/ accepted（承諾済み）/ rejected（辞退）/ canceled（取り消し）。既定は pending（STATE-003）。"
      - name: "expires_at"
        type: "datetime"
        required: true
        description: "有効期限。送信から48時間（団体の招待と同じ）。期限を過ぎた招待は承諾・辞退できない（COND-015）。"
      - name: "inviter_id"
        type: "string"
        required: true
        description: "招待を送った事務局のユーザーID（外部キー）"
      - name: "created_at"
        type: "datetime"
        required: true
        description: "作成日時"
    relations:
      - target: "INFO-006"
        type: "N:1"
        label: "招待者"
    traces_to: ["UC-026", "UC-027", "SCR-018", "SCR-019", "SCR-020"]

  - id: "INFO-010"
    name: "パスキー"
    description: "ユーザーがログインに使うパスキー（WebAuthn の資格情報）。認証基盤（Better Auth）が管理するが、利用者がアカウント設定（SCR-021）で一覧し、名前を変え、削除するため本モデルに含める。ここに載せるのは画面に出す・判定に使う属性だけで、公開鍵・署名カウンター・通信方式・認証器の種別など、認証のためだけの値は省く。last_used_at だけは Better Auth が記録しない値で、アプリが自分で持つ。"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "パスキーID（主キー）"
      - name: "user_id"
        type: "string"
        required: true
        description: "持ち主のユーザーID（外部キー）"
      - name: "name"
        type: "string"
        required: false
        description: "表示名。登録時にサーバーが付け（COND-020）、利用者が変更できる。名前の無い既存のパスキーは、表示の際にCOND-020の規則で組み立てる。"
      - name: "credential_id"
        type: "string"
        required: true
        description: "資格情報ID。認証器の中でこのパスキーを指す値。削除したことを端末へ伝える（UC-030・WebAuthn の Signal API）ときに使う。"
      - name: "aaguid"
        type: "string"
        required: false
        description: "認証器の機種ID。名前を決めるのに使う（COND-020）。Appleの端末などは0埋めで届き、機種が分からない。"
      - name: "backed_up"
        type: "boolean"
        required: true
        description: "同期されるかどうか。true なら iCloud キーチェーンや Google Password Manager などで他の端末と同期される。false なら登録した認証器（セキュリティキーなど）だけに保存されている。登録した時点の値で、その後は更新されない。一覧には「同期される」「同期されない（登録した認証器だけ）」と表示する（別の端末から一覧を見たときに誤解されないよう「この端末」とは書かない）。"
      - name: "created_at"
        type: "datetime"
        required: true
        description: "登録日時。Better Auth が登録時に必ず入れる（DB の列自体は NULL を許す）。"
      - name: "last_used_at"
        type: "datetime"
        required: false
        description: "最後にこのパスキーでログインした日時。Better Auth は記録しないため、アプリが持つ。パスキーでのログインが成功するたびに更新する。登録してから一度も使っていなければ空。"
    relations:
      - target: "INFO-006"
        type: "N:1"
        label: "持ち主"
    traces_to: ["UC-020", "UC-021", "UC-030", "SCR-014", "SCR-015", "SCR-021"]

  - id: "INFO-011"
    name: "ログインセッション"
    description: "ログイン中の端末を表す。ログインのたびに1件作られ、ログアウト・有効期限切れ・ほかの端末からのログアウト（UC-031）・メールアドレスの変更（COND-018）で消える。認証基盤（Better Auth）が管理するが、利用者がアカウント設定（SCR-021）で一覧し、ログアウトさせるため本モデルに含める。ログインしたときの IP アドレスも Better Auth が保存するが、学内ネットワークではほぼ同じ値になり見分けに役立たず、画面にも判定にも使わないため載せない。セッションを識別するトークンは、ほかの端末のログインを乗っ取る手がかりになるため画面にも利用者のブラウザにも渡さず、一覧とログアウトはサーバー側で行う。"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "セッションID（主キー）"
      - name: "user_id"
        type: "string"
        required: true
        description: "ログインしているユーザーのID（外部キー）"
      - name: "user_agent"
        type: "string"
        required: false
        description: "ログインした端末の User-Agent。端末名の組み立てに使う（COND-020）。"
      - name: "created_at"
        type: "datetime"
        required: true
        description: "ログインした日時"
      - name: "updated_at"
        type: "datetime"
        required: true
        description: "最終更新日時。使い続けると有効期限の延長のたびに更新されるが、延長は多くても1日に1回であるため、「最後に使った日」として日単位の目安で表示する。"
      - name: "expires_at"
        type: "datetime"
        required: true
        description: "有効期限。最後の延長から7日（Better Auth の既定値）。"
    relations:
      - target: "INFO-006"
        type: "N:1"
        label: "ログインしているユーザー"
    traces_to: ["UC-019", "UC-020", "UC-023", "UC-031", "UC-036", "SCR-021"]
---

# 情報モデル（横断）

認証基盤（Better Auth）が内部で管理するデータのうち、外部アカウント・認証コードは業務上の情報ではないため、本モデルには含めない。パスキー（INFO-010）とログインセッション（INFO-011）も同じく Better Auth が管理するが、利用者がアカウント設定（SCR-021）で見て操作するため含めている。その場合も、画面に出す・判定に使う属性だけを載せる。招待（INFO-007）は団体運営の業務そのものに現れる情報なので含めている。

各情報の `traces_to` に並ぶ画面（`SCR-*`）は、その情報を `information` に載せている画面（各コンテキストの `boundary.screens`）を逆引きしたものである。両者が食い違ったときは画面側を正とする。画面の `information` には、その画面が表示する・入力を受けるものだけを載せ、ユースケースの結果として裏で作られる・変わるだけの情報は載せない（その関係は、ここの `traces_to` に並ぶユースケース（`UC-*`）で表す）。画面の `information` を変えたら、ここも合わせて直す。

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
    INFO_003 ||--o{ INFO_007 : "招待する"
    INFO_006 ||--o{ INFO_007 : "招待を送る"
    INFO_006 ||--o{ INFO_008 : "操作する"
    INFO_003 |o--o{ INFO_008 : "対象になる"
    INFO_006 ||--o{ INFO_009 : "事務局に招待する"
    INFO_006 ||--o{ INFO_010 : "登録する"
    INFO_006 ||--o{ INFO_011 : "ログインする"

    INFO_006["INFO-006: ユーザー"] {
        string id PK
        string email
        string name
        boolean email_verified
        string image
        boolean is_staff
        datetime created_at
        datetime updated_at
    }
    INFO_003["INFO-003: 団体"] {
        string id PK
        string name
        string slug
        enum status "pending/enabled/disabled"
        string logo
        string metadata
        datetime created_at
        datetime updated_at
    }
    INFO_005["INFO-005: メンバーシップ"] {
        string id PK
        string user_id FK
        string group_id FK
        enum role "admin/member"
        datetime created_at
        datetime updated_at
    }
    INFO_007["INFO-007: 招待"] {
        string id PK
        string group_id FK
        string email
        enum role "admin/member"
        enum status "pending/accepted/rejected/canceled"
        datetime expires_at
        string inviter_id FK
        datetime created_at
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
        boolean sent_as_staff
        string body
        datetime sent_at
    }
    INFO_008["INFO-008: 操作履歴"] {
        string id PK
        datetime occurred_at
        string actor_id
        boolean acted_as_staff
        enum action "VAR-002"
        enum target_type "VAR-003"
        string target_id
        string group_id
        json changes
    }
    INFO_009["INFO-009: 事務局招待"] {
        string id PK
        string email
        enum status "pending/accepted/rejected/canceled"
        datetime expires_at
        string inviter_id FK
        datetime created_at
    }
    INFO_010["INFO-010: パスキー"] {
        string id PK
        string user_id FK
        string name
        string credential_id
        string aaguid
        boolean backed_up
        datetime created_at
        datetime last_used_at
    }
    INFO_011["INFO-011: ログインセッション"] {
        string id PK
        string user_id FK
        string user_agent
        datetime created_at
        datetime updated_at
        datetime expires_at
    }
```

INFO-008 の actor_id・group_id・target_id は論理的な参照であり、外部キー制約を張らない。記録の対象や操作者が後から消えても、記録は残す必要があるためである。

## 予約の開示範囲（COND-008）

INFO-001 の属性は、見る人によって次の3段階で開示する。

| 属性                  | 自団体・事務局 | 他団体（ログイン済み） | 一般（Google Calendar） |
| --------------------- | :------------: | :--------------------: | :---------------------: |
| facility_id（施設名） |       ○        |           ○            |            ○            |
| start_at / end_at     |       ○        |           ○            |            ○            |
| group_id（団体名）    |       ○        |           ○            |            ×            |
| status                |       ○        |           ○            |            ×            |
| headcount             |       ○        |           ×            |            ×            |
| note                  |       ○        |           ×            |            ×            |
| status_reason         |       ○        |           ×            |            ×            |
| created_by            |       ○        |           ×            |            ×            |
| INFO-004 メッセージ   |       ○        |           ×            |            ×            |

Google Calendar に載せるのは承認済みの予約のみ。他団体のログイン済みユーザーには、仮予約もステータス付きで表示する。

メッセージの送信者は氏名で表示する。ただし自団体のメンバーには、INFO-004.sent_as_staff が true のメッセージの送信者を「事務局」とだけ表示する（操作履歴の COND-012 と同じ考え方）。

## 操作履歴の開示範囲（COND-012）

INFO-008 は、記録対象の種類（VAR-003）と見る人によって開示する。範囲は COND-008 と SCR-007 の既存の開示範囲にそろえる。

| 記録対象の種類 | 事務局 | 自団体の管理者 | 自団体のメンバー | 他団体 |
| -------------- | :----: | :------------: | :--------------: | :----: |
| 予約           |   ○    |       ○        |        ○         |   ×    |
| 団体           |   ○    |       ○        |        ×         |   ×    |
| メンバーシップ |   ○    |       ○        |        ×         |   ×    |
| 招待           |   ○    |       ○        |        ×         |   ×    |
| 施設/設備      |   ○    |       ×        |        ×         |   ×    |
| 事務局権限     |   ○    |       ×        |        ×         |   ×    |

団体側（管理者・メンバー）には、acted_as_staff が true の記録の操作者を「事務局」とだけ表示する。
