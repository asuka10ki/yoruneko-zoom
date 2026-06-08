import fs from "node:fs";
import dotenv from "dotenv";
import sodium from "libsodium-wrappers";

dotenv.config();

const owner = "asuka10ki";
const repo = "yoruneko-zoom";
const apiBase = "https://api.github.com";

const ghPat = process.env.GH_PAT?.trim();
if (!ghPat) {
  throw new Error("GH_PAT is required");
}

const tokenPath = "output/zoom-oauth-token.json";
const zoomToken = JSON.parse(fs.readFileSync(tokenPath, "utf8"));

const secrets = {
  SPREADSHEET_ID: requireEnv("SPREADSHEET_ID"),
  ZOOM_CLIENT_ID: requireEnv("ZOOM_CLIENT_ID"),
  ZOOM_CLIENT_SECRET: requireEnv("ZOOM_CLIENT_SECRET"),
  ZOOM_REFRESH_TOKEN: requireTokenValue(zoomToken.refreshToken, "refreshToken"),
  ZOOM_MEETING_ID: requireEnv("ZOOM_MEETING_ID"),
  SLACK_WEBHOOK_URL: requireEnv("SLACK_WEBHOOK_URL"),
  GH_PAT: ghPat
};

const variables = {
  SHEET_NAME: process.env.SHEET_NAME?.trim() || "ルーム管理",
  TIMEZONE: process.env.TIMEZONE?.trim() || "Asia/Tokyo",
  SLACK_NOTIFY_ON_SUCCESS: process.env.SLACK_NOTIFY_ON_SUCCESS?.trim() || "true",
  ZOOM_UPDATE_ENABLED: process.env.ZOOM_UPDATE_ENABLED?.trim() || "true"
};

await sodium.ready;

const publicKey = await githubJson(`/repos/${owner}/${repo}/actions/secrets/public-key`);

for (const [name, value] of Object.entries(secrets)) {
  await putSecret(name, value, publicKey);
  console.log(`secret registered: ${name}`);
}

for (const [name, value] of Object.entries(variables)) {
  await upsertVariable(name, value);
  console.log(`variable registered: ${name}`);
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing`);
  }
  return value;
}

function requireTokenValue(value, name) {
  if (!value || typeof value !== "string") {
    throw new Error(`output/zoom-oauth-token.json ${name} is missing`);
  }
  return value;
}

async function putSecret(name, value, publicKey) {
  const encryptedValue = encryptSecret(value, publicKey.key);
  await githubJson(`/repos/${owner}/${repo}/actions/secrets/${name}`, {
    method: "PUT",
    body: JSON.stringify({
      encrypted_value: encryptedValue,
      key_id: publicKey.key_id
    })
  });
}

function encryptSecret(value, publicKey) {
  const messageBytes = sodium.from_string(value);
  const keyBytes = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes);
  return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
}

async function upsertVariable(name, value) {
  const patchResponse = await githubFetch(`/repos/${owner}/${repo}/actions/variables/${name}`, {
    method: "PATCH",
    body: JSON.stringify({ name, value })
  });

  if (patchResponse.status !== 404) {
    await assertOk(patchResponse);
    return;
  }

  const createResponse = await githubFetch(`/repos/${owner}/${repo}/actions/variables`, {
    method: "POST",
    body: JSON.stringify({ name, value })
  });
  await assertOk(createResponse);
}

async function githubJson(path, init = {}) {
  const response = await githubFetch(path, init);
  await assertOk(response);
  if (response.status === 204) {
    return undefined;
  }
  return await response.json();
}

async function githubFetch(path, init = {}) {
  return await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${ghPat}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {})
    }
  });
}

async function assertOk(response) {
  if (response.ok) {
    return;
  }

  let message = `${response.status} ${response.statusText}`;
  try {
    const body = await response.json();
    message = body.message || message;
  } catch {
    // Keep the generic HTTP message.
  }

  throw new Error(`GitHub API request failed: ${message}`);
}
