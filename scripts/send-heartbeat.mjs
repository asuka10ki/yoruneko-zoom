import fs from "node:fs/promises";

const [, , eventName = "", triggerSource = "", targetDate = "", outcome = "", runId = "", runUrl = ""] = process.argv;
const heartbeatUrl = process.env.HEARTBEAT_URL?.trim();
const heartbeatSecret = process.env.HEARTBEAT_SECRET?.trim();
const result = await readJson("output/result.json", null);

if (!heartbeatUrl || !heartbeatSecret) {
  console.log("heartbeat skipped: HEARTBEAT_URL or HEARTBEAT_SECRET is not set");
  process.exit(0);
}

const payload = {
  date: result?.date || targetDate,
  success: result?.success ?? outcome === "success",
  runId,
  runUrl,
  triggerSource,
  eventName,
  error: result?.error || ""
};

const response = await fetch(heartbeatUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${heartbeatSecret}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

if (!response.ok) {
  throw new Error(`heartbeat failed: status=${response.status}`);
}

console.log(`heartbeat sent: date=${payload.date}, success=${payload.success}, source=${triggerSource || eventName}`);

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}
