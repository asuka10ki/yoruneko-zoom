import fs from "node:fs/promises";

const owner = "asuka10ki";
const repo = "yoruneko-zoom";
const apiBase = "https://api.github.com";
const title = "Zoomブレイクアウトルーム実行ダッシュボード";
const historyPath = "docs/data/runs.json";

const token = process.env.GITHUB_TOKEN?.trim();
if (!token) {
  throw new Error("GITHUB_TOKEN is required");
}

const history = await readJson(historyPath, { runs: [] });
const runs = Array.isArray(history.runs) ? history.runs : [];
const issue = await findIssue();
const body = buildBody(runs);

if (issue) {
  await githubJson(`/repos/${owner}/${repo}/issues/${issue.number}`, {
    method: "PATCH",
    body: JSON.stringify({ body })
  });
  console.log(`dashboard issue updated: #${issue.number}`);
} else {
  const created = await githubJson(`/repos/${owner}/${repo}/issues`, {
    method: "POST",
    body: JSON.stringify({
      title,
      body,
      labels: ["dashboard"]
    })
  });
  console.log(`dashboard issue created: #${created.number}`);
}

async function findIssue() {
  const issues = await githubJson(`/repos/${owner}/${repo}/issues?state=open&per_page=100`);
  return issues.find((issue) => issue.title === title);
}

function buildBody(runs) {
  const latest = runs[0];
  const successCount = runs.filter((run) => run.success === true).length;
  const failureCount = runs.filter((run) => run.success === false).length;
  const runWorkflowUrl = `https://github.com/${owner}/${repo}/actions/workflows/zoom-breakout-rooms.yml`;

  return [
    "# Zoomブレイクアウトルーム実行ダッシュボード",
    "",
    `[▶ 手動実行する](${runWorkflowUrl})`,
    "",
    "| 項目 | 値 |",
    "| --- | --- |",
    `| 最新結果 | ${latest ? statusText(latest.success) : "-"} |`,
    `| 最新日付 | ${latest?.date || "-"} |`,
    `| 成功数 | ${successCount} |`,
    `| 失敗数 | ${failureCount} |`,
    "",
    "## 実行履歴",
    "",
    "| 実行時刻(JST) | 種別 | 日付 | 結果 | ルーム数 | 詳細 |",
    "| --- | --- | --- | --- | ---: | --- |",
    ...(runs.length > 0 ? runs.slice(0, 30).map(historyRow) : ["| - | - | - | - | - | まだ実行履歴がありません |"]),
    "",
    "<!-- dashboard-managed -->"
  ].join("\n");
}

function historyRow(run) {
  const details = run.runUrl ? `[Actionsログ](${run.runUrl})` : "-";
  const error = run.error ? `<br>${escapeCell(run.error)}` : "";
  return [
    formatJst(run.recordedAt),
    eventText(run.eventName),
    escapeCell(run.date || run.requestedTargetDate || "-"),
    `${statusText(run.success)}${error}`,
    run.roomCount ?? "-",
    details
  ].map((value) => String(value)).join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function statusText(success) {
  if (success === true) return "成功";
  if (success === false) return "失敗";
  return "不明";
}

function eventText(eventName) {
  if (eventName === "schedule") return "自動";
  if (eventName === "workflow_dispatch") return "手動";
  return eventName || "-";
}

function formatJst(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo"
  }).format(new Date(value));
}

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function githubJson(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API failed: ${response.status} ${body}`);
  }

  return await response.json();
}
