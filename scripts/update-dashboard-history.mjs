import fs from "node:fs/promises";
import path from "node:path";

const [, , eventName = "", requestedTargetDate = "", outcome = "", runId = "", runUrl = ""] = process.argv;
const historyPath = "docs/data/runs.json";
const resultPath = "output/result.json";
const maxRuns = 100;

const result = await readJson(resultPath, null);
const history = await readJson(historyPath, { runs: [] });

const entry = {
  recordedAt: new Date().toISOString(),
  eventName,
  requestedTargetDate,
  outcome,
  runId,
  runUrl,
  success: result?.success ?? outcome === "success",
  date: result?.date ?? requestedTargetDate,
  meetingId: result?.meetingId,
  roomCount: result?.roomCount,
  rooms: result?.rooms,
  error: result?.error,
  csvPath: result?.csvPath,
  logPath: result?.logPath
};

const runs = Array.isArray(history.runs) ? history.runs : [];
runs.unshift(entry);

await fs.mkdir(path.dirname(historyPath), { recursive: true });
await fs.writeFile(historyPath, `${JSON.stringify({ runs: runs.slice(0, maxRuns) }, null, 2)}\n`, "utf8");

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}
