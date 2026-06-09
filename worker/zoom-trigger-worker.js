const defaultWorkflowFile = "zoom-breakout-rooms.yml";
const defaultDispatchCron = "0 9 * * *";
const defaultMonitorCron = "20 9 * * *";
const timezone = "Asia/Tokyo";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = buildCorsHeaders(env, origin);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/heartbeat") {
        return await handleHeartbeat(request, env, corsHeaders);
      }

      const body = await safeJson(request);
      const targetDate = typeof body.target_date === "string" ? body.target_date.trim() : "";

      if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        return jsonResponse({ error: "target_date must be YYYY-MM-DD" }, 400, corsHeaders);
      }

      const result = await dispatchWorkflow(env, {
        targetDate,
        triggerSource: "dashboard"
      });

      return jsonResponse(result, 202, corsHeaders);
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500, corsHeaders);
    }
  },

  async scheduled(controller, env, ctx) {
    if (isCron(controller.cron, env.MONITOR_CRONS || defaultMonitorCron)) {
      ctx.waitUntil(monitorHeartbeat(env));
      return;
    }

    if (isCron(controller.cron, env.DISPATCH_CRONS || defaultDispatchCron)) {
      ctx.waitUntil(
        dispatchWorkflow(env, {
          targetDate: todayInTimezone(),
          triggerSource: "cloudflare_cron"
        })
      );
    }
  }
};

async function dispatchWorkflow(env, options = {}) {
  const owner = requiredEnv(env, "GITHUB_OWNER");
  const repo = requiredEnv(env, "GITHUB_REPO");
  const githubToken = env.GITHUB_TOKEN || env.GH_PAT;
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const workflowFile = env.GITHUB_WORKFLOW_ID || env.WORKFLOW_FILE || defaultWorkflowFile;
  const inputs = {
    trigger_source: options.triggerSource || "unknown"
  };

  if (options.targetDate) {
    inputs.target_date = options.targetDate;
  }

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "Content-Type": "application/json",
      "User-Agent": "yoruneko-zoom-trigger",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({
      ref: env.GITHUB_REF || "main",
      inputs
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub Actions dispatch failed: status=${response.status}`);
  }

  return {
    ok: true,
    targetDate: options.targetDate || "",
    triggerSource: inputs.trigger_source
  };
}

async function handleHeartbeat(request, env, corsHeaders) {
  const secret = requiredEnv(env, "HEARTBEAT_SECRET");
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";

  if (token !== secret) {
    return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
  }

  const heartbeats = requiredEnv(env, "HEARTBEATS");
  const body = await safeJson(request);
  const date = typeof body.date === "string" && body.date ? body.date : todayInTimezone();
  const runId = typeof body.runId === "string" ? body.runId : "";
  const heartbeat = {
    recordedAt: new Date().toISOString(),
    date,
    success: body.success === true,
    runId,
    runUrl: typeof body.runUrl === "string" ? body.runUrl : "",
    triggerSource: typeof body.triggerSource === "string" ? body.triggerSource : "",
    eventName: typeof body.eventName === "string" ? body.eventName : "",
    error: typeof body.error === "string" ? body.error : ""
  };

  await heartbeats.put(`heartbeat:${date}:latest`, JSON.stringify(heartbeat));
  await heartbeats.put("heartbeat:latest", JSON.stringify(heartbeat));
  if (runId) {
    await heartbeats.put(`heartbeat:${date}:${runId}`, JSON.stringify(heartbeat));
  }

  return jsonResponse({ ok: true }, 202, corsHeaders);
}

async function monitorHeartbeat(env) {
  const heartbeats = requiredEnv(env, "HEARTBEATS");
  const date = todayInTimezone();
  const latest = await readKvJson(heartbeats, `heartbeat:${date}:latest`);

  if (latest?.success === true) {
    return;
  }

  const alertKey = `alert:${date}:missing-success-heartbeat`;
  if (await heartbeats.get(alertKey)) {
    return;
  }

  await notifySlack(env, buildMissingHeartbeatText(date, latest));
  await heartbeats.put(alertKey, new Date().toISOString(), { expirationTtl: 36 * 60 * 60 });
}

function buildMissingHeartbeatText(date, latest) {
  const lastHeartbeat = latest
    ? [
        `記録時刻: ${latest.recordedAt || "-"}`,
        `結果: ${latest.success ? "成功" : "失敗または未成功"}`,
        `起動元: ${latest.triggerSource || latest.eventName || "-"}`,
        `Run: ${latest.runUrl || "-"}`
      ].join("\n")
    : "なし";

  return [
    "⚠️ Zoomブレイクアウトルーム事前設定バッチの成功確認ができません",
    "",
    "バッチが起動していない、または成功heartbeatがありません。",
    `対象日: ${date}`,
    "",
    "最終heartbeat:",
    lastHeartbeat,
    "",
    "確認ポイント:",
    "- GitHub Actionsの実行履歴",
    "- Zoom OAuth refresh token",
    "- Googleスプレッドシートの対象日行",
    "- Slack通知とActions secrets"
  ].join("\n");
}

async function notifySlack(env, text) {
  const webhookUrl = requiredEnv(env, "SLACK_WEBHOOK_URL");
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error(`Slack notification failed: status=${response.status}`);
  }
}

function buildCorsHeaders(env, origin) {
  const allowedOrigin = env.ALLOWED_ORIGIN || "*";
  const responseOrigin = allowedOrigin === "*" || allowedOrigin === origin ? allowedOrigin : "null";

  return {
    "Access-Control-Allow-Origin": responseOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonResponse(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders
    }
  });
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function requiredEnv(env, name) {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function readKvJson(kv, key) {
  const value = await kv.get(key);
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isCron(actual, expectedList) {
  return String(expectedList)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(actual);
}

function todayInTimezone() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
