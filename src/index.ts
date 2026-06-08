import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { writeRoomsCsv, CSV_PATH } from "./csv";
import { getTargetDate } from "./dateUtils";
import { readRoomsForDate } from "./googleSheets";
import { Logger } from "./logger";
import { notifyFailure, notifySuccess } from "./slack";
import { updateZoomBreakoutRooms, ZoomApiError } from "./zoom";

const RESULT_PATH = "output/result.json";

type ResultJson = {
  success: boolean;
  date: string;
  meetingId: string;
  roomCount?: number;
  rooms?: string[];
  zoomUpdateEnabled?: boolean;
  zoomSkipped?: boolean;
  error?: string;
  csvPath: string;
  logPath: string;
};

async function main(): Promise<number> {
  const timezone = process.env.TIMEZONE?.trim() || "Asia/Tokyo";
  const today = getTargetDate(timezone);
  const logger = new Logger(today);
  let csvPath = CSV_PATH;
  let rooms: string[] = [];
  let meetingId = process.env.ZOOM_MEETING_ID?.trim() || "";
  let slackWebhookUrl = process.env.SLACK_WEBHOOK_URL?.trim() || undefined;
  let csvWritten = false;

  logger.info("バッチ開始");
  logger.info(`今日の日付: ${today}`);

  try {
    const config = loadConfig();
    meetingId = config.zoomMeetingId;
    slackWebhookUrl = config.slackWebhookUrl;

    const sheetResult = await readRoomsForDate({
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName,
      targetDate: today,
      timezone: config.timezone,
      logger
    });

    rooms = sheetResult.rooms;
    logger.info(`ルーム数: ${rooms.length}`);

    csvPath = await writeRoomsCsv(rooms);
    csvWritten = true;
    logger.info(`CSV出力完了: ${csvPath}`);

    if (rooms.length === 0) {
      throw new Error("C列〜V列に有効なルーム名が1つもありません");
    }

    if (config.zoomUpdateEnabled) {
      await updateZoomBreakoutRooms(
        {
          clientId: config.zoomClientId,
          clientSecret: config.zoomClientSecret,
          redirectUri: config.zoomRedirectUri,
          meetingId: config.zoomMeetingId
        },
        rooms,
        logger
      );
    } else {
      logger.info("Zoom API更新スキップ: ZOOM_UPDATE_ENABLED=false");
    }

    await writeResult({
      success: true,
      date: today,
      meetingId,
      roomCount: rooms.length,
      rooms,
      zoomUpdateEnabled: config.zoomUpdateEnabled,
      zoomSkipped: !config.zoomUpdateEnabled,
      csvPath,
      logPath: logger.logPath
    });

    if (config.slackNotifyOnSuccess) {
      try {
        await notifySuccess({
          webhookUrl: config.slackWebhookUrl,
          date: today,
          meetingId,
          roomCount: rooms.length,
          csvPath,
          logPath: logger.logPath
        });
      } catch (slackError) {
        logger.error(errorToMessage(slackError));
      }
    }

    logger.info("バッチ成功");
    return 0;
  } catch (error) {
    const message = errorToMessage(error);
    logger.error(message);

    if (error instanceof ZoomApiError) {
      logger.error(`status: ${error.status}`);
      logger.error(`message: ${error.message}`);
      if (error.body) {
        logger.error(`response: ${error.body}`);
      }
    }

    if (!csvWritten) {
      try {
        csvPath = await writeRoomsCsv(rooms);
        csvWritten = true;
        logger.info(`CSV出力完了: ${csvPath}`);
      } catch (csvError) {
        logger.error(`CSV出力失敗: ${errorToMessage(csvError)}`);
      }
    }

    await writeResult({
      success: false,
      date: today,
      meetingId,
      error: message,
      csvPath,
      logPath: logger.logPath
    });

    try {
      await notifyFailure({
        webhookUrl: slackWebhookUrl,
        date: today,
        meetingId,
        error: message,
        csvPath,
        logPath: logger.logPath
      });
    } catch (slackError) {
      logger.error(errorToMessage(slackError));
    }

    logger.error("バッチ失敗");
    return 1;
  }
}

async function writeResult(result: ResultJson): Promise<void> {
  await fs.mkdir(path.dirname(RESULT_PATH), { recursive: true });
  await fs.writeFile(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("[ERROR] 予期しない例外");
    console.error(error);
    process.exitCode = 1;
  });
