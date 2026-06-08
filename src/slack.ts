export async function notifyFailure(options: {
  webhookUrl?: string;
  date: string;
  meetingId: string;
  error: string;
  csvPath: string;
  logPath: string;
}): Promise<void> {
  if (!options.webhookUrl) {
    return;
  }

  const text = [
    "❌ Zoomブレイクアウトルーム事前設定バッチ失敗",
    "",
    `日付: ${options.date}`,
    `Meeting ID: ${options.meetingId}`,
    `エラー: ${options.error}`,
    `CSV: ${options.csvPath}`,
    `ログ: ${options.logPath}`
  ].join("\n");

  const response = await fetch(options.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack notification failed: status=${response.status}, body=${body}`);
  }
}

export async function notifySuccess(options: {
  webhookUrl?: string;
  date: string;
  meetingId: string;
  roomCount: number;
  csvPath: string;
  logPath: string;
}): Promise<void> {
  if (!options.webhookUrl) {
    return;
  }

  const text = [
    "✅ Zoomブレイクアウトルーム事前設定バッチ成功",
    "",
    `日付: ${options.date}`,
    `Meeting ID: ${options.meetingId}`,
    `ルーム数: ${options.roomCount}`,
    `CSV: ${options.csvPath}`,
    `ログ: ${options.logPath}`
  ].join("\n");

  const response = await fetch(options.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack notification failed: status=${response.status}, body=${body}`);
  }
}
