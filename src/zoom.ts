import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Logger } from "./logger";

export type ZoomConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  meetingId: string;
};

type ZoomTokenFile = {
  accessToken?: string;
  refreshToken: string;
  expiresAt?: number;
};

type ZoomErrorBody = {
  code?: number;
  message?: string;
  reason?: string;
  [key: string]: unknown;
};

export class ZoomApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
    this.name = "ZoomApiError";
  }
}

export async function updateZoomBreakoutRooms(config: ZoomConfig, rooms: string[], logger: Logger): Promise<void> {
  logger.info("Zoom OAuth開始");
  const accessToken = await getUserOAuthAccessToken(config, logger);

  logger.info("Zoom API更新開始");
  const payload = {
    settings: {
      breakout_room: {
        enable: true,
        rooms: rooms.map((name) => ({
          name,
          participants: []
        }))
      }
    }
  };

  const response = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(config.meetingId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw await toZoomApiError("Zoom API update failed", response);
  }

  logger.info("Zoom API更新成功");
}

async function getUserOAuthAccessToken(config: ZoomConfig, logger: Logger): Promise<string> {
  const token = await readTokenFile();
  if (token?.refreshToken) {
    try {
      return await refreshUserOAuthToken(config, token.refreshToken, logger);
    } catch (error) {
      logger.error(`Zoom OAuth refresh失敗: ${error instanceof Error ? error.message : String(error)}`);
      if (isGitHubActions()) {
        throw error;
      }
      logger.info("初回認可フローを開始します");
    }
  }

  if (isGitHubActions()) {
    throw new Error("ZOOM_REFRESH_TOKEN is required in GitHub Actions");
  }

  return await authorizeUserOAuth(config, logger);
}

async function refreshUserOAuthToken(config: ZoomConfig, refreshToken: string, logger: Logger): Promise<string> {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const url = new URL("https://zoom.us/oauth/token");
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("refresh_token", refreshToken);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`
    }
  });

  if (!response.ok) {
    throw await toZoomApiError("Zoom OAuth refresh failed", response);
  }

  const body = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!body.access_token || !body.refresh_token) {
    throw new Error("Zoom OAuth refresh failed: token missing");
  }

  await writeTokenFile({
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000
  }, logger);

  logger.info("Zoom OAuth refresh成功");
  return body.access_token;
}

async function authorizeUserOAuth(config: ZoomConfig, logger: Logger): Promise<string> {
  if (!config.redirectUri) {
    throw new Error("ZOOM_REDIRECT_URI is required for initial Zoom OAuth authorization");
  }

  const redirectUrl = new URL(config.redirectUri);
  const expectedPath = redirectUrl.pathname;
  const port = Number(redirectUrl.port || 80);
  const state = randomUUID();
  const codePromise = waitForOAuthCode(port, expectedPath, state);

  const authorizeUrl = new URL("https://zoom.us/oauth/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("state", state);

  logger.info("以下のURLをブラウザで開き、Zoomで認可してください");
  logger.info(authorizeUrl.toString());
  console.log("");
  console.log("Zoom認可URL:");
  console.log(authorizeUrl.toString());
  console.log("");

  const code = await codePromise;
  return await exchangeAuthorizationCode(config, code, logger);
}

function waitForOAuthCode(port: number, expectedPath: string, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Zoom OAuth authorization timed out"));
    }, 5 * 60 * 1000);

    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", `http://localhost:${port}`);
      if (requestUrl.pathname !== expectedPath) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state");

      if (error) {
        clearTimeout(timeout);
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(`Zoom authorization failed: ${error}`);
        server.close();
        reject(new Error(`Zoom authorization failed: ${error}`));
        return;
      }

      if (!code || state !== expectedState) {
        clearTimeout(timeout);
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Invalid OAuth callback");
        server.close();
        reject(new Error("Invalid OAuth callback"));
        return;
      }

      clearTimeout(timeout);
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Zoom認可が完了しました。このブラウザタブは閉じて大丈夫です。");
      server.close();
      resolve(code);
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1");
  });
}

async function exchangeAuthorizationCode(config: ZoomConfig, code: string, logger: Logger): Promise<string> {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const url = new URL("https://zoom.us/oauth/token");
  url.searchParams.set("grant_type", "authorization_code");
  url.searchParams.set("code", code);
  url.searchParams.set("redirect_uri", config.redirectUri);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`
    }
  });

  if (!response.ok) {
    throw await toZoomApiError("Zoom OAuth authorization failed", response);
  }

  const body = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!body.access_token || !body.refresh_token) {
    throw new Error("Zoom OAuth authorization failed: token missing");
  }

  await writeTokenFile({
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000
  }, logger);

  logger.info("Zoom OAuth認可成功");
  return body.access_token;
}

async function readTokenFile(): Promise<ZoomTokenFile | null> {
  const actionsRefreshToken = process.env.ZOOM_REFRESH_TOKEN?.trim();
  if (isGitHubActions() && actionsRefreshToken) {
    return {
      refreshToken: actionsRefreshToken
    };
  }

  try {
    const text = await fs.readFile(getTokenPath(), "utf8");
    return JSON.parse(text) as ZoomTokenFile;
  } catch {
    return null;
  }
}

async function writeTokenFile(token: ZoomTokenFile, logger?: Logger): Promise<void> {
  if (isGitHubActions()) {
    await writeGitHubSecret("ZOOM_REFRESH_TOKEN", token.refreshToken);
    logger?.info("Zoom OAuth refresh token保存成功: GitHub Actions Secret ZOOM_REFRESH_TOKEN");
    return;
  }

  const tokenPath = getTokenPath();
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, `${JSON.stringify(token, null, 2)}\n`, "utf8");
  logger?.info(`Zoom OAuth token保存成功: ${tokenPath}`);
}

function getTokenPath(): string {
  return "output/zoom-oauth-token.json";
}

function isGitHubActions(): boolean {
  return process.env.GITHUB_ACTIONS === "true";
}

async function writeGitHubSecret(name: string, value: string): Promise<void> {
  const repo = process.env.GITHUB_REPOSITORY?.trim();
  const ghPat = process.env.GH_PAT?.trim();

  if (!repo) {
    throw new Error("GITHUB_REPOSITORY is required to update GitHub Secrets");
  }

  if (!ghPat) {
    throw new Error("GH_PAT is required to update GitHub Secrets");
  }

  await runSecretSetCommand(name, value, repo, ghPat);
}

function runSecretSetCommand(name: string, value: string, repo: string, ghPat: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", ["secret", "set", name, "--repo", repo], {
      env: {
        ...process.env,
        GH_TOKEN: ghPat
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`GitHub Secret update failed: gh exited with code ${code}${stderr ? `, stderr=${stderr.trim()}` : ""}`));
    });

    child.stdin.end(value);
  });
}

async function toZoomApiError(defaultMessage: string, response: Response): Promise<ZoomApiError> {
  const bodyText = await response.text();
  let message = defaultMessage;

  try {
    const body = JSON.parse(bodyText) as ZoomErrorBody;
    message = body.message || body.reason || defaultMessage;
  } catch {
    if (bodyText) {
      message = bodyText;
    }
  }

  return new ZoomApiError(message, response.status, bodyText);
}
