const owner = "asuka10ki";
const repo = "yoruneko-zoom";
const workflowFile = "zoom-breakout-rooms.yml";
const workflowUrl = `https://github.com/${owner}/${repo}/actions/workflows/${workflowFile}`;
const runButton = document.querySelector("#runButton");
const message = document.querySelector("#message");
const runsBody = document.querySelector("#runsBody");
const refreshButton = document.querySelector("#refreshButton");
const summary = document.querySelector("#summary");

runButton.addEventListener("click", () => {
  window.open(workflowUrl, "_blank", "noopener,noreferrer");
  showMessage("GitHub Actionsの実行画面を開きました。Run workflowを押すと実行されます。");
});

refreshButton.addEventListener("click", loadRuns);

loadRuns();

async function loadRuns() {
  try {
    const response = await fetch(`./data/runs.json?ts=${Date.now()}`, {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error("実行履歴を読み込めませんでした。");
    }

    const data = await response.json();
    renderRuns(Array.isArray(data.runs) ? data.runs : []);
    showMessage("実行履歴を更新しました。");
  } catch (error) {
    renderRuns([]);
    showMessage(error instanceof Error ? error.message : String(error), true);
  }
}

function renderRuns(runs) {
  const latest = runs[0];
  const successCount = runs.filter((run) => run.success === true).length;
  const failureCount = runs.filter((run) => run.success === false).length;

  summary.innerHTML = [
    summaryCard("最新結果", latest ? statusText(latest.success) : "-"),
    summaryCard("最新日付", latest?.date || "-"),
    summaryCard("成功", String(successCount)),
    summaryCard("失敗", String(failureCount))
  ].join("");

  if (runs.length === 0) {
    runsBody.innerHTML = `<tr><td colspan="6">まだ実行履歴がありません。</td></tr>`;
    return;
  }

  runsBody.innerHTML = runs
    .map((run) => {
      const statusClass = run.success === true ? "success" : run.success === false ? "failure" : "unknown";
      const rooms = Array.isArray(run.rooms) && run.rooms.length > 0 ? `<div class="rooms">${escapeHtml(run.rooms.join(" / "))}</div>` : "";
      const detail = run.runUrl ? `<a href="${escapeAttribute(run.runUrl)}" target="_blank" rel="noreferrer">Actionsログ</a>` : "";

      return `
        <tr>
          <td>${escapeHtml(formatDateTime(run.recordedAt))}</td>
          <td>${escapeHtml(eventText(run.eventName))}</td>
          <td>${escapeHtml(run.date || run.requestedTargetDate || "-")}</td>
          <td><span class="status ${statusClass}">${escapeHtml(statusText(run.success))}</span>${run.error ? `<div class="rooms">${escapeHtml(run.error)}</div>` : ""}</td>
          <td>${escapeHtml(String(run.roomCount ?? "-"))}${rooms}</td>
          <td>${detail}</td>
        </tr>
      `;
    })
    .join("");
}

function summaryCard(label, value) {
  return `
    <div class="summary-card">
      <span class="summary-label">${escapeHtml(label)}</span>
      <span class="summary-value">${escapeHtml(value)}</span>
    </div>
  `;
}

function eventText(eventName) {
  if (eventName === "schedule") {
    return "自動";
  }
  if (eventName === "workflow_dispatch") {
    return "手動";
  }
  return eventName || "-";
}

function statusText(success) {
  if (success === true) {
    return "成功";
  }
  if (success === false) {
    return "失敗";
  }
  return "不明";
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
