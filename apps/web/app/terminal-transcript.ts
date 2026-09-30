import { readFile } from "node:fs/promises";

const MAX_TRANSCRIPT_LENGTH = 1_500_000;

export async function readSessionTranscript(terminalLogPath?: string): Promise<string | undefined> {
  return terminalLogPath ? readPlainTerminalTranscript(terminalLogPath) : undefined;
}

async function readPlainTerminalTranscript(filePath: string): Promise<string | undefined> {
  try {
    const output = await readFile(filePath, "utf8");
    if (usesAlternateScreen(output)) {
      return undefined;
    }

    return trimTranscript(toPlainTerminalText(output));
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function usesAlternateScreen(value: string): boolean {
  return /\u001b\[\?(?:47|1047|1049)h/.test(value);
}

function toPlainTerminalText(value: string): string {
  return value
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[()][0-?]/g, "")
    .replace(/\u001b[=><]/g, "")
    .replaceAll("\u0000", "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0001-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
    .replace(/\n/g, "\r\n");
}

function trimTranscript(value: string): string {
  if (value.length <= MAX_TRANSCRIPT_LENGTH) {
    return value;
  }

  const start = value.indexOf("\r\n", value.length - MAX_TRANSCRIPT_LENGTH);
  return `Earlier messages omitted.\r\n\r\n${value.slice(start === -1 ? 0 : start + 2)}`;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
