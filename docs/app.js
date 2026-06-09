const config = window.YORUNEKO_ZOOM_CONFIG || {};

const targetDate = document.querySelector("#targetDate");
const todayButton = document.querySelector("#todayButton");
const runButton = document.querySelector("#runButton");
const message = document.querySelector("#message");
const runsBody = document.querySelector("#runsBody");
const refreshButton = document.querySelector("#refreshButton");
const summary = document.querySelector("#summary");

targetDate.value = formatDateInTimeZone(new Date(), "Asia/Tokyo");

todayButton.addEventListener("click", () => {
  targetDate.value = formatDateInTimeZone(new Date(), "Asia/Tokyo");
});

runButton.addEventListener("click", runWorkflow);
refreshButton.addEventListener("click", loadRuns);

loadRuns();

async function runWorkflow() {
  const endpoint = String(config.triggerEndpoint || "").trim();
  if (!endpoint) {
    showMessage("実行APIが未設定です。管理者にCloudflare WorkerのURL設定を依頼してください。", true);
    return;
  }

  runButton.disabled = true;
  showMessage("実行を開始しています...");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        target_date: targetDate.value || ""
      })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "実行開始に失敗しました。");
    }

    showMessage("実行を開始しました。少し待ってから更新してください。");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error), true);
  } finally {
    runButton.disabled = false;
  }
}

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
  if (eventName === "cloudflare_cron") return "自動(Cloudflare)";
  if (eventName === "github_schedule") return "自動(GitHub)";
  if (eventName === "dashboard") return "画面手動";
  if (eventName === "manual") return "手動";
  if (eventName === "schedule") return "自動";
  if (eventName === "workflow_dispatch") return "手動";
  return eventName || "-";
}

function statusText(success) {
  if (success === true) return "成功";
  if (success === false) return "失敗";
  return "不明";
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function formatDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDateTime(value) {
  if (!value) return "-";

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
