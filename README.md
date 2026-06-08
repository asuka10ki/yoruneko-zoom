# Zoomブレイクアウトルーム事前設定バッチ

Googleスプレッドシートの「ルーム管理」シートから当日分のブレイクアウトルーム名を読み取り、Zoomのスケジュール済みミーティングへ事前割り当て設定を登録するCLIバッチです。

## 必要なもの

- Node.js 20以上
- 公開設定されたGoogleスプレッドシート
- Zoomの一般アプリ（OAuth）
- Slack Incoming Webhook URL（失敗通知が不要な場合は未設定でも可）

## セットアップ

1. 依存関係をインストールします。

```bat
npm install
```

2. `.env.example` を参考に `.env` を作成します。

```env
SPREADSHEET_ID=
SHEET_NAME=ルーム管理

ZOOM_UPDATE_ENABLED=true
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=
ZOOM_REDIRECT_URI=http://localhost:53682/zoom/callback
ZOOM_MEETING_ID=

SLACK_WEBHOOK_URL=
SLACK_NOTIFY_ON_SUCCESS=true
TIMEZONE=Asia/Tokyo
TARGET_DATE=
```

3. 対象スプレッドシートを公開設定にします。

共有設定で「リンクを知っている全員」が閲覧できる状態にしてください。このアプリは公開CSVとしてシートを読み取るため、Google APIキーやサービスアカウントJSONは不要です。

4. ビルドします。

```bat
npm run build
```

## スプレッドシート形式

対象シート名は標準で `ルーム管理` です。

| 列 | 内容 |
| --- | --- |
| A列 | 日付 |
| C列〜V列 | ブレイクアウトルーム名 |

A列の日付は以下を同じ日付として扱います。

- `2026/05/28`
- `2026-05-28`
- `2026年5月28日`
- Google Sheetsの日付型

## 実行

開発実行:

```bat
npm run dev
```

本番実行:

```bat
npm start
```

成功時は終了コード `0`、失敗時は終了コード `1` で終了します。

動作確認で日付を固定したい場合だけ、`.env` の `TARGET_DATE` に `2026-06-01` のように指定できます。通常運用では空のままにしてください。

Zoom API更新を一時的に止めたい場合は、`.env` を次のようにするとCSV作成だけを成功扱いで実行できます。

```env
ZOOM_UPDATE_ENABLED=false
```

この場合、Zoom API更新はスキップされます。出力された `output/zoom-breakout-rooms.csv` をZoomのブレイクアウトルーム事前割り当てCSVとして画面からインポートしてください。

通常OAuthでZoom API更新する場合は、Zoomの一般アプリで取得した値を設定します。

```env
ZOOM_UPDATE_ENABLED=true
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=
ZOOM_REDIRECT_URI=http://localhost:53682/zoom/callback
```

初回実行時はコンソールにZoom認可URLが表示されます。そのURLをブラウザで開いて許可すると、`output/zoom-oauth-token.json` にrefresh tokenが保存され、次回以降は自動で更新します。このtokenファイルは秘密情報なのでGit管理しません。

## 出力ファイル

毎回、以下のファイルを出力します。

- `logs/YYYY-MM-DD.log`
- `output/result.json`

Zoom API更新の成功・失敗に関係なく、ルーム取得後は以下のCSVを出力します。

- `output/zoom-breakout-rooms.csv`

CSV形式:

```csv
Pre-assign Room Name,Email Address
第1ルーム,
第2ルーム,
```

## Slack通知

失敗時はSlack Incoming Webhookへ通知します。`SLACK_NOTIFY_ON_SUCCESS=true` の場合は成功時も通知します。初期運用では成功も失敗も確認できるように `true` を推奨します。

通知対象:

- Google Sheets読み取り失敗
- 今日の日付の行が見つからない
- C列〜V列に有効なルーム名がない
- Zoom OAuth失敗
- Zoom API更新失敗
- CSV出力失敗
- その他の予期しない例外

Slack通知自体に失敗した場合も、元のエラーとSlack通知エラーをログへ残します。

## Windowsバッチファイル

`run_zoom_rooms.bat` の先頭にあるプロジェクトパスは、このフォルダに合わせてあります。別の場所へ移した場合は実際の配置場所に変更してください。

```bat
cd /d C:\asuka-windows\app\夜の猫町プラスzoom
```

## Windowsタスクスケジューラ設定

毎日18:00に実行する例です。

1. Windowsの「タスク スケジューラ」を開きます。
2. 「基本タスクの作成」を選びます。
3. トリガーは「毎日」を選びます。
4. 開始時刻を `18:00` にします。
5. 操作は「プログラムの開始」を選びます。
6. プログラムに `run_zoom_rooms.bat` のフルパスを指定します。
7. PCが起動している必要があります。スリープ中や電源オフの場合は実行されません。

## 注意

- `.env` はGit管理しません。
- `logs/` と `output/` は `.gitkeep` のみGit管理します。
- Googleスプレッドシートは公開CSVとして読み取ります。非公開シートを読みたい場合は、認証方式の追加が必要です。
- Zoom APIが参加者なしの空ルーム登録を受け付けない場合、API更新は失敗扱いになります。その場合もCSVとログから原因を確認できます。

## GitHub Actionsでの実行

自宅PCを起動せず、GitHub Actionsから毎日18:00 JSTに実行できます。

Workflow:

```text
.github/workflows/zoom-breakout-rooms.yml
```

実行画面:

```text
https://asuka10ki.github.io/yoruneko-zoom/
```

この画面では以下ができます。

- ボタンだけでGitHub Actionsを実行する
- 実行履歴を確認する
- 自動実行・手動実行の結果を一覧で見る
- 任意日付を指定して手動実行する

実行履歴はGitHub Issueの `Zoomブレイクアウトルーム実行ダッシュボード` にも追記されます。

### GitHub Secrets

GitHubリポジトリの `Settings` → `Secrets and variables` → `Actions` → `Secrets` に以下を登録します。

```text
SPREADSHEET_ID
ZOOM_CLIENT_ID
ZOOM_CLIENT_SECRET
ZOOM_REFRESH_TOKEN
ZOOM_MEETING_ID
SLACK_WEBHOOK_URL
GH_PAT
```

`ZOOM_REFRESH_TOKEN` は、ローカルPCの `output/zoom-oauth-token.json` にある `refreshToken` の値を登録します。`accessToken` や `expiresAt` は登録不要です。

`GH_PAT` は、Actions内から `ZOOM_REFRESH_TOKEN` Secretを更新するためのGitHub Personal Access Tokenです。Secrets更新ができる権限を付けてください。

Fine-grained tokenを使う場合は、対象リポジトリに対してActions secretsを更新できる権限を付けます。Classic tokenを使う場合は、private repositoryでは `repo` 権限が必要です。

### GitHub Variables

同じ画面の `Variables` に以下を登録します。

```text
SHEET_NAME=ルーム管理
TIMEZONE=Asia/Tokyo
SLACK_NOTIFY_ON_SUCCESS=true
ZOOM_UPDATE_ENABLED=true
```

workflow側にも同じデフォルト値を設定しているため、Variablesが未登録でも上記の値で実行されます。

### 自動実行

GitHub ActionsはUTC基準なので、18:00 JSTに合わせて以下のcronで実行します。

```yaml
cron: "0 9 * * *"
```

### 手動実行

GitHub画面から実行する場合:

1. リポジトリを開く。
2. `Actions` タブを開く。
3. `Zoom Breakout Rooms` workflowを選ぶ。
4. `Run workflow` を押す。
5. 必要なら `target_date` に `YYYY-MM-DD` を入力する。
6. `Run workflow` で実行する。

`target_date` を空にすると、`Asia/Tokyo` 基準の当日で実行します。

### iPhoneのGitHubアプリから実行

1. GitHubアプリで対象リポジトリを開く。
2. `Actions` を開く。
3. `Zoom Breakout Rooms` を選ぶ。
4. `Run workflow` を押す。
5. 必要なら `target_date` を入力する。
6. 実行する。

### 実行画面から実行

GitHub Pagesの実行画面を開きます。

```text
https://asuka10ki.github.io/yoruneko-zoom/
```

操作:

1. 必要なら対象日を指定する。
2. `実行する` を押す。
3. 少し待ってから `更新` を押す。

GitHubを使えない人でも、画面のボタンだけで実行できます。

### ボタン実行API

GitHub Pagesの静的HTMLだけではGitHub Actionsを安全に起動できないため、Cloudflare Workerを中継APIとして使います。

Workerコード:

```text
worker/zoom-trigger-worker.js
```

Workerに設定する環境変数:

```text
GITHUB_OWNER=asuka10ki
GITHUB_REPO=yoruneko-zoom
WORKFLOW_FILE=zoom-breakout-rooms.yml
GITHUB_REF=main
ALLOWED_ORIGIN=https://asuka10ki.github.io
```

Workerに設定するSecret:

```text
GH_PAT
```

`GH_PAT` にはGitHub Actions workflowをdispatchできる権限が必要です。Fine-grained tokenを使う場合は、対象リポジトリに対してActionsのRead and write権限を付けます。

Workerをデプロイしたら、`docs/config.js` の `triggerEndpoint` にWorkerのURLを設定します。

```js
window.YORUNEKO_ZOOM_CONFIG = {
  triggerEndpoint: "https://your-worker.example.workers.dev"
};
```

### refresh token更新方式

Actions実行時は `.env` や `output/zoom-oauth-token.json` を使いません。

1. `ZOOM_REFRESH_TOKEN` Secretからrefresh tokenを読む。
2. Zoom OAuth refresh APIでaccess tokenを取得する。
3. Zoomから返った新しいrefresh tokenを、`GH_PAT` を使って `ZOOM_REFRESH_TOKEN` Secretへ保存し直す。
4. 次回実行では更新後のSecretを使う。

token、Client Secret、Slack Webhook URLはログに出しません。

`GH_PAT` を用意できない場合の代替案は、private repository内に暗号化したtokenファイルを置き、Actionsで復号して使う方式です。ただし復号鍵の管理が別途必要になるため、このプロジェクトではGitHub Secretsを更新する方式を標準とします。`output/zoom-oauth-token.json` をそのままコミットする運用は行いません。

### 障害時の確認

GitHub Actionsの実行ログを確認してください。

確認場所:

```text
Actions → Zoom Breakout Rooms → 該当run
```

Artifactsに以下が保存されます。

```text
logs/
output/result.json
output/zoom-breakout-rooms.csv
```

よくある原因:

- `ZOOM_REFRESH_TOKEN` が未設定、期限切れ、または古い
- `GH_PAT` にSecrets更新権限がない
- Slack Webhook URLが無効
- スプレッドシートに対象日付の行がない
- Zoom一般アプリのscopeが不足している
