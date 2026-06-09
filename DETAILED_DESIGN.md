# Zoomブレイクアウトルーム事前設定バッチ 詳細設計書

## 1. アーキテクチャ

CLIエントリポイント `src/index.ts` が全体制御を行い、各処理を機能別モジュールへ委譲する。

```text
index.ts
  ├─ config.ts
  ├─ dateUtils.ts
  ├─ logger.ts
  ├─ googleSheets.ts
  ├─ roomNormalizer.ts
  ├─ csv.ts
  ├─ zoom.ts
  └─ slack.ts
```

GitHub Pages画面、Cloudflare Worker Cron、heartbeat監視を含めた全体構成:

```text
docs/index.html
  └─ docs/app.js
       ├─ docs/config.js
       ├─ docs/data/runs.json
       └─ Cloudflare Worker triggerEndpoint
              ├─ fetch: 画面ボタンからGitHub Actions workflow_dispatch
              ├─ scheduled 18:00 JST: GitHub Actions workflow_dispatch
              ├─ scheduled 18:20 JST: Cloudflare KV heartbeat確認
              └─ /heartbeat: GitHub Actionsから結果を保存
                    └─ zoom-breakout-rooms.yml
                         ├─ npm start
                         ├─ scripts/send-heartbeat.mjs
                         ├─ scripts/update-dashboard-history.mjs
                         ├─ scripts/update-issue-dashboard.mjs
                         └─ GitHub Pages deploy
```

## 2. モジュール設計

### 2.1 `src/index.ts`

役割:

- 設定読み込み
- 対象日算出
- ロガー初期化
- Googleスプレッドシート読み取り
- CSV出力
- Zoom API更新
- result.json出力
- Slack通知
- 終了コード制御

正常系処理:

1. `loadConfig()` で設定を読み込む。
2. `getTargetDate()` で対象日を決定する。
3. `readRoomsForDate()` でルーム一覧を取得する。
4. `writeRoomsCsv()` でCSVを出力する。
5. ルーム数が0件ならエラーにする。
6. `ZOOM_UPDATE_ENABLED=true` の場合、`updateZoomBreakoutRooms()` を実行する。
7. `output/result.json` に成功結果を出力する。
8. `SLACK_NOTIFY_ON_SUCCESS=true` の場合、Slack成功通知を送信する。
9. exit code `0` を返す。

異常系処理:

1. エラーをログ出力する。
2. Zoom APIエラーの場合、HTTPステータスとレスポンス本文をログ出力する。
3. CSV未出力の場合、可能な範囲でCSVを出力する。
4. `output/result.json` に失敗結果を出力する。
5. Slack失敗通知を送信する。
6. exit code `1` を返す。

### 2.2 `src/config.ts`

役割:

- `.env` 読み込み
- 必須環境変数の検証
- boolean設定の解釈

型:

```ts
export type AppConfig = {
  spreadsheetId: string;
  sheetName: string;
  zoomUpdateEnabled: boolean;
  zoomClientId: string;
  zoomClientSecret: string;
  zoomRedirectUri: string;
  zoomMeetingId: string;
  slackWebhookUrl?: string;
  slackNotifyOnSuccess: boolean;
  timezone: string;
};
```

必須項目:

- `SPREADSHEET_ID`
- `ZOOM_MEETING_ID`
- `ZOOM_CLIENT_ID`
- `ZOOM_CLIENT_SECRET`
- `ZOOM_REDIRECT_URI`

ただし `ZOOM_UPDATE_ENABLED=false` の場合、Zoom OAuth関連の必須検証は行わない。

### 2.3 `src/dateUtils.ts`

役割:

- Asia/Tokyo基準の当日算出
- スプレッドシート日付値の正規化
- 動作確認用 `TARGET_DATE` の解釈

関数:

```ts
getTodayInTimezone(timezone: string): string
getTargetDate(timezone: string): string
parseSheetDate(value: unknown, timezone: string): string | null
```

`getTargetDate()`:

- `TARGET_DATE` が設定されていれば `YYYY-MM-DD` として使用する。
- 未設定なら `getTodayInTimezone()` を使用する。

`parseSheetDate()` が受け付ける形式:

- `2026/05/28`
- `2026-05-28`
- `2026年5月28日`
- 数値シリアル日付
- JavaScript `Date` で解釈可能な文字列

### 2.4 `src/googleSheets.ts`

役割:

- 公開GoogleスプレッドシートをCSVとして取得する。
- 対象日の行を検索する。
- C列〜V列からルーム名を取得する。

取得URL:

```text
https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet={SHEET_NAME}
```

主な関数:

```ts
readRoomsForDate(options): Promise<SheetRoomsResult>
```

戻り値:

```ts
export type SheetRoomsResult = {
  rooms: string[];
  rowNumber: number;
};
```

CSVパーサ:

- ダブルクォート囲み
- エスケープされた `""`
- CRLF / LF
- カンマ区切り

を処理する。

### 2.5 `src/roomNormalizer.ts`

役割:

- ルーム名の正規化
- 空欄除外
- 重複除外

正規化:

```ts
String(value)
  .replace(/[\r\n\t]/g, "")
  .replace(/[ \u3000]+/g, " ")
  .trim()
```

関数:

```ts
normalizeRoomName(value: unknown): string | null
normalizeRoomList(values: unknown[]): string[]
```

重複判定は正規化後の文字列で行う。

### 2.6 `src/csv.ts`

役割:

- Zoom事前割り当て用CSVを出力する。

出力先:

```text
output/zoom-breakout-rooms.csv
```

ヘッダー:

```csv
Pre-assign Room Name,Email Address
```

ルーム行:

```csv
{roomName},
```

CSVエスケープ:

- カンマ
- ダブルクォート
- 改行

を含む場合はダブルクォートで囲む。

### 2.7 `src/zoom.ts`

役割:

- Zoom OAuth認可
- refresh tokenによるアクセストークン更新
- Zoomミーティング更新API呼び出し

tokenファイル:

```text
output/zoom-oauth-token.json
```

GitHub Actions実行時はtokenファイルを使わず、`ZOOM_REFRESH_TOKEN` Secretからrefresh tokenを読み込む。

tokenファイル構造:

```ts
type ZoomTokenFile = {
  accessToken?: string;
  refreshToken: string;
  expiresAt?: number;
};
```

OAuth refresh処理:

1. GitHub Actionsでは `ZOOM_REFRESH_TOKEN` Secretを読む。
2. ローカル開発実行では `output/zoom-oauth-token.json` を読む。
3. `grant_type=refresh_token` でZoom OAuth token endpointへPOSTする。
4. 新しいaccess token / refresh tokenを保存する。
5. ログに保存成功を出力する。

```text
[INFO] Zoom OAuth refresh token保存成功: GitHub Actions Secret ZOOM_REFRESH_TOKEN
[INFO] Zoom OAuth token保存成功: output/zoom-oauth-token.json
[INFO] Zoom OAuth refresh成功
```

初回認可処理:

1. `http://localhost:53682/zoom/callback` でローカルHTTPサーバーを起動する。
2. 認可URLをログとコンソールへ出力する。
3. callbackでauthorization codeを受け取る。
4. `grant_type=authorization_code` でtokenへ交換する。
5. tokenファイルへ保存する。

Zoomミーティング更新API:

```http
PATCH https://api.zoom.us/v2/meetings/{ZOOM_MEETING_ID}
Authorization: Bearer {accessToken}
Content-Type: application/json
```

payload:

```json
{
  "settings": {
    "breakout_room": {
      "enable": true,
      "rooms": [
        {
          "name": "第1ルーム",
          "participants": []
        }
      ]
    }
  }
}
```

エラー:

`ZoomApiError` にHTTPステータスとレスポンス本文を保持する。

### 2.8 `src/slack.ts`

役割:

- Slack Incoming Webhook通知

関数:

```ts
notifyFailure(options): Promise<void>
notifySuccess(options): Promise<void>
```

送信方式:

```http
POST {SLACK_WEBHOOK_URL}
Content-Type: application/json

{ "text": "..." }
```

Webhook URL未設定時は何もしない。

### 2.9 `src/logger.ts`

役割:

- console出力
- ログファイル出力

ログファイル:

```text
logs/YYYY-MM-DD.log
```

形式:

```text
[INFO] message
[ERROR] message
```

## 3. データフロー

```text
.env
  ↓
config.ts
  ↓
index.ts
  ├─ dateUtils.ts
  ├─ googleSheets.ts
  │    └─ roomNormalizer.ts
  ├─ csv.ts
  ├─ zoom.ts
  ├─ slack.ts
  └─ logger.ts
```

## 4. シーケンス

### 4.1 通常成功

```text
index
  -> loadConfig
  -> getTargetDate
  -> readRoomsForDate
  -> writeRoomsCsv
  -> updateZoomBreakoutRooms
      -> refreshUserOAuthToken
      -> writeTokenFile
      -> PATCH /meetings/{id}
  -> writeResult(success)
  -> notifySuccess
  -> exit 0
```

### 4.1.1 GitHub Actions通常成功

```text
GitHub Actions
  -> scripts/decide-scheduled-run.mjs
  -> 当日成功済みでなければ続行
  -> npm ci
  -> npm run build
  -> npm start
index
  -> loadConfig from Secrets/Variables
  -> getTargetDate from workflow_dispatch input or today
  -> readRoomsForDate
  -> writeRoomsCsv
  -> updateZoomBreakoutRooms
      -> read ZOOM_REFRESH_TOKEN
      -> refreshUserOAuthToken
      -> update GitHub Secret ZOOM_REFRESH_TOKEN via GH_PAT
      -> PATCH /meetings/{id}
  -> writeResult(success)
  -> notifySuccess
  -> scripts/send-heartbeat.mjs
      -> POST Cloudflare Worker /heartbeat
      -> Cloudflare KV HEARTBEATSへ保存
  -> upload artifacts
```

### 4.1.2 Cloudflare Cron主起動

```text
Cloudflare Cron 18:00 JST / 09:00 UTC
  -> worker.scheduled()
  -> GitHub Actions workflow_dispatch API
     inputs.trigger_source = cloudflare_cron
  -> Zoom Breakout Rooms workflow starts
```

### 4.1.3 Cloudflare heartbeat監視

```text
Cloudflare Cron 18:20 JST / 09:20 UTC
  -> worker.scheduled()
  -> Cloudflare KV HEARTBEATS
      -> heartbeat:YYYY-MM-DD:latest を取得
  -> success=true がなければSlackへ警告
```

Slack警告は同一日で重複しないよう、`alert:YYYY-MM-DD:missing-success-heartbeat` をKVへ保存する。

### 4.1.4 GitHub Actionsスケジュール再試行

```text
schedule 18:05 JST
  -> 当日成功済みでなければ実行

schedule 18:15 JST
  -> 18:05が成功済みならスキップ
  -> 未成功なら実行

schedule 18:30 JST
  -> 18:05または18:15が成功済みならスキップ
  -> 未成功なら実行
```

当日成功済みかどうかは `docs/data/runs.json` の `success: true` かつ `date: YYYY-MM-DD` で判定する。
GitHub `schedule` とCloudflare Cron起動の場合はこの判定を行う。画面手動実行の場合は指定された対象日で実行する。

### 4.1.5 画面ボタン手動実行

```text
User
  -> GitHub Pages dashboard
  -> click "手動で実行する"
  -> POST Cloudflare Worker
  -> Worker validates target_date
  -> Worker calls GitHub workflow_dispatch API with GITHUB_TOKEN
  -> Zoom Breakout Rooms workflow starts
```

### 4.1.6 実行履歴更新

```text
Zoom Breakout Rooms workflow
  -> npm start
  -> scripts/update-dashboard-history.mjs
      -> update docs/data/runs.json
  -> commit docs/data/runs.json
  -> scripts/update-issue-dashboard.mjs
      -> create/update dashboard issue
  -> actions/configure-pages
  -> actions/upload-pages-artifact
  -> actions/deploy-pages
```

### 4.2 対象日なし

```text
index
  -> readRoomsForDate
  -> error
  -> writeRoomsCsv([])
  -> writeResult(false)
  -> notifyFailure
  -> exit 1
```

### 4.3 Zoom API失敗

```text
index
  -> readRoomsForDate
  -> writeRoomsCsv
  -> updateZoomBreakoutRooms
  -> ZoomApiError
  -> log status/body
  -> writeResult(false)
  -> notifyFailure
  -> exit 1
```

## 5. ファイル設計

```text
zoom-room-batch/
  .github/
    workflows/
      deploy-dashboard.yml
      zoom-breakout-rooms.yml
  docs/
    index.html
    app.js
    config.js
    styles.css
    data/
      runs.json
  package.json
  package-lock.json
  tsconfig.json
  .env.example
  README.md
  EXTERNAL_DESIGN.md
  DETAILED_DESIGN.md
  src/
    index.ts
    config.ts
    logger.ts
    googleSheets.ts
    zoom.ts
    slack.ts
    csv.ts
    dateUtils.ts
    roomNormalizer.ts
  scripts/
    register-github-actions-settings.mjs
    decide-scheduled-run.mjs
    send-heartbeat.mjs
    update-dashboard-history.mjs
    update-issue-dashboard.mjs
  worker/
    zoom-trigger-worker.js
  output/
    .gitkeep
    zoom-oauth-token.json
    zoom-breakout-rooms.csv
    result.json
  logs/
    .gitkeep
    YYYY-MM-DD.log
```

## 5.1 GitHub Pages画面設計

画面ファイル:

```text
docs/index.html
docs/styles.css
docs/app.js
docs/config.js
docs/data/runs.json
```

`docs/config.js`:

```js
window.YORUNEKO_ZOOM_CONFIG = {
  triggerEndpoint: "https://yoruneko-zoom-trigger.swallowbath.workers.dev"
};
```

画面初期表示:

- 対象日入力欄にAsia/Tokyo基準の本日を設定する。
- `docs/data/runs.json` を読み込み、履歴を表示する。

手動実行:

- `手動で実行する` ボタン押下で `triggerEndpoint` にPOSTする。
- request body:

```json
{
  "target_date": "2026-06-08"
}
```

履歴更新:

- `更新` ボタン押下で `docs/data/runs.json` をcache bust付きで再取得する。

## 5.2 Cloudflare Worker設計

Workerファイル:

```text
worker/zoom-trigger-worker.js
```

endpoint:

```text
POST https://yoruneko-zoom-trigger.swallowbath.workers.dev
```

request:

```json
{
  "target_date": "2026-06-08"
}
```

`target_date` は任意。空の場合、workflow側でAsia/Tokyo基準の当日を使用する。

validation:

- `target_date` が空でない場合、`YYYY-MM-DD` のみ許可する。
- methodはPOSTのみ許可する。
- CORSは `ALLOWED_ORIGIN` を許可する。

GitHub API call:

```http
POST https://api.github.com/repos/asuka10ki/yoruneko-zoom/actions/workflows/zoom-breakout-rooms.yml/dispatches
Authorization: Bearer {GH_PAT}
Content-Type: application/json
```

body:

```json
{
  "ref": "main",
  "inputs": {
    "target_date": "2026-06-08"
  }
}
```

secrets:

- `GH_PAT` はCloudflare Worker Secretとして保持する。
- `GH_PAT` をブラウザ、GitHub Pages、ログへ出力しない。

## 6. npm scripts

```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

## 7. Git管理対象外

`.gitignore` で以下を除外する。

```text
node_modules/
dist/
.env
logs/*
output/*
output/zoom-oauth-token.json
```

`logs/.gitkeep` と `output/.gitkeep` は管理対象にできる。

## 8. 注意事項

- Slack Webhook URLとZoom Client Secretは秘密情報として扱う。
- `output/zoom-oauth-token.json` はrefresh tokenを含むため秘密情報として扱う。
- GitHub Actionsでは `ZOOM_REFRESH_TOKEN` Secretをrefresh tokenの正とする。
- GitHub Actionsでrefresh token保存に失敗した場合は、次回実行失敗を防ぐため当該実行を失敗扱いにする。
- 本番運用では `TARGET_DATE` を設定しない。
- スプレッドシートが非公開になると読み取りに失敗する。
- Zoom一般アプリのscopeが不足するとZoom API更新に失敗する。
