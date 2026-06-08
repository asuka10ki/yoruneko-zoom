# Zoomブレイクアウトルーム事前設定バッチ 外部設計書

## 1. システム概要

本システムは、公開Googleスプレッドシートの「ルーム管理」シートから当日分のブレイクアウトルーム名を取得し、Zoomのスケジュール済みミーティングへブレイクアウトルーム事前設定を登録するWindows向けCLIバッチである。

実行画面は持たず、Windowsタスクスケジューラから毎日定刻に起動する。

## 2. 利用者と運用

想定利用者:

- バッチの初期設定を行う運用者
- Zoomミーティングを管理する担当者
- Slack通知で実行結果を確認する担当者

通常運用:

1. Windowsタスクスケジューラが毎日18:00に `run_zoom_rooms.bat` を実行する。
2. バッチが当日の日付に対応するルーム名をスプレッドシートから取得する。
3. CSVを出力する。
4. Zoom APIで対象ミーティングを更新する。
5. Slackへ結果を通知する。

## 3. 外部システム

| 外部システム | 用途 |
| --- | --- |
| Googleスプレッドシート | ルーム管理データの取得元 |
| Zoom REST API | ミーティングのブレイクアウトルーム事前設定更新 |
| Zoom OAuth | Zoom REST API用アクセストークン取得 |
| Slack Incoming Webhook | 実行結果通知 |
| Windowsタスクスケジューラ | Windows PCでの定期実行 |
| GitHub Actions | 自宅PC不要の定期実行・手動実行 |

## 4. 入力

### 4.1 環境変数

`.env` に以下を設定する。

```env
# Google Sheets
SPREADSHEET_ID=
SHEET_NAME=ルーム管理

# Zoom
ZOOM_UPDATE_ENABLED=true
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=
ZOOM_REDIRECT_URI=http://localhost:53682/zoom/callback
ZOOM_MEETING_ID=

# Slack
SLACK_WEBHOOK_URL=
SLACK_NOTIFY_ON_SUCCESS=true

# App
TIMEZONE=Asia/Tokyo
```

### 4.2 Googleスプレッドシート

対象シート名:

```text
ルーム管理
```

列仕様:

| 列 | 内容 |
| --- | --- |
| A列 | 日付 |
| C列〜V列 | ブレイクアウトルーム名 |

シートは公開CSVとして取得できる状態にする。

## 5. 出力

### 5.1 CSV

出力先:

```text
output/zoom-breakout-rooms.csv
```

形式:

```csv
Pre-assign Room Name,Email Address
第1ルーム,
第2ルーム,
```

Zoom API更新の成功・失敗に関係なく、ルーム取得後は必ず出力する。

### 5.2 ログ

出力先:

```text
logs/YYYY-MM-DD.log
```

主な出力内容:

- バッチ開始
- 対象日
- シート読み込み開始
- 対象行
- ルーム数
- CSV出力結果
- Zoom OAuth結果
- Zoom OAuth token保存結果
- Zoom API更新結果
- バッチ成否
- APIエラー時のHTTPステータスとレスポンス本文

### 5.3 結果JSON

出力先:

```text
output/result.json
```

成功時:

```json
{
  "success": true,
  "date": "2026-06-01",
  "meetingId": "89216377281",
  "roomCount": 7,
  "rooms": ["猫の集会A"],
  "zoomUpdateEnabled": true,
  "zoomSkipped": false,
  "csvPath": "output/zoom-breakout-rooms.csv",
  "logPath": "logs/2026-06-01.log"
}
```

失敗時:

```json
{
  "success": false,
  "date": "2026-06-01",
  "meetingId": "89216377281",
  "error": "Zoom API update failed",
  "csvPath": "output/zoom-breakout-rooms.csv",
  "logPath": "logs/2026-06-01.log"
}
```

## 6. Slack通知

Slack Incoming Webhookで通知する。

通知条件:

- 失敗時は通知する。
- `SLACK_NOTIFY_ON_SUCCESS=true` の場合、成功時も通知する。
- `SLACK_WEBHOOK_URL` が未設定の場合は通知しない。

成功通知:

```text
✅ Zoomブレイクアウトルーム事前設定バッチ成功

日付: 2026-06-01
Meeting ID: 89216377281
ルーム数: 7
CSV: output/zoom-breakout-rooms.csv
ログ: logs/2026-06-01.log
```

失敗通知:

```text
❌ Zoomブレイクアウトルーム事前設定バッチ失敗

日付: 2026-06-01
Meeting ID: 89216377281
エラー: Zoom API update failed
CSV: output/zoom-breakout-rooms.csv
ログ: logs/2026-06-01.log
```

## 7. Zoom OAuth

Zoom一般アプリのOAuthを使用する。

Zoomアプリ側設定:

```text
OAuth Redirect URL: http://localhost:53682/zoom/callback
Scope: meeting:update:meeting
```

初回実行時:

1. バッチが認可URLをコンソールとログへ出力する。
2. 利用者がブラウザでURLを開き、Zoom認可を行う。
3. callbackをローカルHTTPサーバーで受け取る。
4. refresh tokenを `output/zoom-oauth-token.json` に保存する。

2回目以降:

- 保存済みrefresh tokenでアクセストークンを更新する。
- token保存成功をログに出力する。

## 8. エラー処理

失敗扱いにする主なケース:

- スプレッドシート読み取り失敗
- 対象日付の行が見つからない
- 有効なルーム名が0件
- CSV出力失敗
- Zoom OAuth失敗
- Zoom API更新失敗
- Slack通知以外の予期しない例外

Slack通知失敗時:

- 元のエラーは維持する。
- Slack通知エラーはconsoleとログに出力する。

## 9. 終了コード

| 状態 | 終了コード |
| --- | ---: |
| 成功 | 0 |
| 失敗 | 1 |

## 10. Windowsタスクスケジューラ

毎日18:00に以下を実行する。

```text
C:\asuka-windows\app\夜の猫町プラスzoom\run_zoom_rooms.bat
```

開始場所:

```text
C:\asuka-windows\app\夜の猫町プラスzoom
```

PCが起動しており、ネットワーク接続があることを前提とする。

## 11. GitHub Actions運用

GitHub Actionsでは、自宅PCを起動せずにバッチを実行する。

実行方法:

- 毎日18:00 JSTの自動実行
- GitHub画面からの手動実行
- iPhoneのGitHubアプリからの手動実行

workflow:

```text
.github/workflows/zoom-breakout-rooms.yml
```

schedule:

```yaml
cron: "0 9 * * *"
```

18:00 JSTは09:00 UTCとして設定する。

### 11.1 GitHub Secrets

```text
SPREADSHEET_ID
ZOOM_CLIENT_ID
ZOOM_CLIENT_SECRET
ZOOM_REFRESH_TOKEN
ZOOM_MEETING_ID
SLACK_WEBHOOK_URL
GH_PAT
```

### 11.2 GitHub Variables

```text
SHEET_NAME=ルーム管理
TIMEZONE=Asia/Tokyo
SLACK_NOTIFY_ON_SUCCESS=true
ZOOM_UPDATE_ENABLED=true
```

### 11.3 refresh token保存先

GitHub Actionsでは `output/zoom-oauth-token.json` を使わない。

refresh tokenの保存先はGitHub Actions Secretの `ZOOM_REFRESH_TOKEN` とする。Zoom OAuth refresh APIから新しいrefresh tokenが返った場合、`GH_PAT` を使って `ZOOM_REFRESH_TOKEN` を更新する。

`GH_PAT` が未設定、または権限不足でSecret更新に失敗した場合、次回実行で古いrefresh tokenを使って失敗する可能性があるため、当該実行は失敗扱いにする。

### 11.4 手動実行

`workflow_dispatch` で手動実行できる。

入力:

```text
target_date
```

`target_date` が空の場合はAsia/Tokyo基準の当日で実行する。値を指定する場合は `YYYY-MM-DD` とする。

### 11.5 実行結果確認

GitHub Actionsの実行ログとArtifactで確認する。

Artifact:

```text
logs/
output/result.json
output/zoom-breakout-rooms.csv
```

## 12. セキュリティ

秘密情報:

- `.env`
- `output/zoom-oauth-token.json`
- Slack Incoming Webhook URL
- Zoom Client Secret
- Zoom Refresh Token
- GitHub Personal Access Token

これらはGit管理しない。
