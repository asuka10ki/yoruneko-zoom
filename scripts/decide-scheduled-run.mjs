import fs from "node:fs/promises";
import fsSync from "node:fs";

const [, , eventName = "", requestedTargetDate = ""] = process.argv;
const historyPath = "docs/data/runs.json";
const timezone = process.env.TIMEZONE || "Asia/Tokyo";

const targetDate = requestedTargetDate || todayInTimezone(timezone);
let shouldRun = true;
let reason = "manual run";

if (eventName === "schedule") {
  const history = await readJson(historyPath, { runs: [] });
  const runs = Array.isArray(history.runs) ? history.runs : [];
  const alreadySucceeded = runs.some((run) => run?.success === true && run?.date === targetDate);

  shouldRun = !alreadySucceeded;
  reason = alreadySucceeded ? `success already recorded for ${targetDate}` : `no success recorded for ${targetDate}`;
}

writeOutput("should_run", shouldRun ? "true" : "false");
writeOutput("target_date", targetDate);

console.log(`event: ${eventName || "(unknown)"}`);
console.log(`target_date: ${targetDate}`);
console.log(`should_run: ${shouldRun}`);
console.log(`reason: ${reason}`);

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function todayInTimezone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  fsSync.appendFileSync(outputPath, `${name}=${value}\n`, "utf8");
}
