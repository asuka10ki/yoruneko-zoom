import fs from "node:fs";

export class Logger {
  public readonly logPath: string;

  constructor(date: string) {
    this.logPath = `logs/${date}.log`;
    fs.mkdirSync("logs", { recursive: true });
  }

  info(message: string): void {
    this.write("INFO", message);
  }

  error(message: string): void {
    this.write("ERROR", message);
  }

  private write(level: "INFO" | "ERROR", message: string): void {
    const line = `[${level}] ${message}`;
    console[level === "ERROR" ? "error" : "log"](line);
    fs.appendFileSync(this.logPath, `${line}\n`, "utf8");
  }
}
