import type { Logger } from "./logger";
import { parseSheetDate } from "./dateUtils";
import { normalizeRoomList } from "./roomNormalizer";

export type SheetRoomsResult = {
  rooms: string[];
  rowNumber: number;
};

export async function readRoomsForDate(options: {
  spreadsheetId: string;
  sheetName: string;
  targetDate: string;
  timezone: string;
  logger: Logger;
}): Promise<SheetRoomsResult> {
  const { spreadsheetId, sheetName, targetDate, timezone, logger } = options;

  logger.info("ルーム管理シート読み込み開始");

  const rows = await fetchPublicSheetCsv(spreadsheetId, sheetName);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rowDate = parseSheetDate(row[0], timezone);
    if (rowDate !== targetDate) {
      continue;
    }

    logger.info(`対象行を検出: ${index + 1}行目`);
    const rooms = normalizeRoomList(row.slice(2, 22));
    return {
      rooms,
      rowNumber: index + 1
    };
  }

  throw new Error(`今日の日付の行が見つかりません: ${targetDate}`);
}

async function fetchPublicSheetCsv(spreadsheetId: string, sheetName: string): Promise<string[][]> {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq`);
  url.searchParams.set("tqx", "out:csv");
  url.searchParams.set("sheet", sheetName);

  const response = await fetch(url);
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Google Sheets読み取り失敗: status=${response.status}, body=${body}`);
  }

  if (body.includes("<!DOCTYPE html") || body.includes("<html")) {
    throw new Error("Google Sheets読み取り失敗: シートが公開されていない、またはシート名が違う可能性があります");
  }

  return parseCsv(body);
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  return rows;
}
