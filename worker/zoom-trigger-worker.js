const defaultWorkflowFile = "zoom-breakout-rooms.yml";

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
      const body = await safeJson(request);
      const targetDate = typeof body.target_date === "string" ? body.target_date.trim() : "";

      if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        return jsonResponse({ error: "target_date must be YYYY-MM-DD" }, 400, corsHeaders);
      }

      const owner = requiredEnv(env, "GITHUB_OWNER");
      const repo = requiredEnv(env, "GITHUB_REPO");
      const ghPat = requiredEnv(env, "GH_PAT");
      const workflowFile = env.WORKFLOW_FILE || defaultWorkflowFile;

      const inputs = {};
      if (targetDate) {
        inputs.target_date = targetDate;
      }

      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${ghPat}`,
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
        return jsonResponse(
          {
            error: "GitHub Actions dispatch failed",
            status: response.status
          },
          502,
          corsHeaders
        );
      }

      return jsonResponse({ ok: true }, 202, corsHeaders);
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500, corsHeaders);
    }
  }
};

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
