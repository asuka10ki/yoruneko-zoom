import dotenv from "dotenv";

dotenv.config();

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

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string {
  return process.env[name]?.trim() || "";
}

function readBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value);
}

export function loadConfig(): AppConfig {
  const zoomUpdateEnabled = readBoolean("ZOOM_UPDATE_ENABLED", true);
  const isGitHubActions = process.env.GITHUB_ACTIONS === "true";

  return {
    spreadsheetId: requireEnv("SPREADSHEET_ID"),
    sheetName: process.env.SHEET_NAME?.trim() || "ルーム管理",
    zoomUpdateEnabled,
    zoomClientId: zoomUpdateEnabled ? requireEnv("ZOOM_CLIENT_ID") : optionalEnv("ZOOM_CLIENT_ID"),
    zoomClientSecret: zoomUpdateEnabled ? requireEnv("ZOOM_CLIENT_SECRET") : optionalEnv("ZOOM_CLIENT_SECRET"),
    zoomRedirectUri: zoomUpdateEnabled && !isGitHubActions ? requireEnv("ZOOM_REDIRECT_URI") : optionalEnv("ZOOM_REDIRECT_URI"),
    zoomMeetingId: requireEnv("ZOOM_MEETING_ID"),
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL?.trim() || undefined,
    slackNotifyOnSuccess: readBoolean("SLACK_NOTIFY_ON_SUCCESS", false),
    timezone: process.env.TIMEZONE?.trim() || "Asia/Tokyo"
  };
}
