import fs from "node:fs/promises";
import path from "node:path";

export const CSV_PATH = "output/zoom-breakout-rooms.csv";

export async function writeRoomsCsv(rooms: string[], csvPath = CSV_PATH): Promise<string> {
  await fs.mkdir(path.dirname(csvPath), { recursive: true });
  const lines = ["Pre-assign Room Name,Email Address", ...rooms.map((room) => `${escapeCsv(room)},`)];
  await fs.writeFile(csvPath, `${lines.join("\r\n")}\r\n`, "utf8");
  return csvPath;
}

function escapeCsv(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}
