import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { SessionRecord } from "@supply-flow/core/session";

const MAX_TRANSCRIPT_LENGTH = 1_500_000;

interface ClaudeJournalEntry {
  type?: unknown;
  message?: {
    content?: unknown;
  };
}

export async function readSessionTranscript(
  session: SessionRecord,
  terminalLogPath?: string
): Promise<string | undefined> {
  if (session.providerId === "claude-code") {
    const transcript = await readClaudeTranscript(session);
    if (transcript !== undefined) {
      return transcript;
    }
  }

  return terminalLogPath ? readPlainTerminalTranscript(terminalLogPath) : undefined;
}

async function readClaudeTranscript(session: SessionRecord): Promise<string | undefined> {
  const directory = path.join(
    homedir(),
    ".claude",
    "projects",
    session.workspacePath.replaceAll(/[^A-Za-z0-9]+/g, "-")
  );

  try {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue;
      }

      const journal = await readFile(path.join(directory, entry.name), "utf8");
      if (!journal.includes(session.id)) {
        continue;
      }

      return formatClaudeJournal(journal, session.id);
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }

  return undefined;
}

function formatClaudeJournal(journal: string, sessionId: string): string {
  const turns: string[] = [];

  for (const line of journal.split("\n")) {
    if (!line) {
      continue;
    }

    let entry: ClaudeJournalEntry;
    try {
      entry = JSON.parse(line) as ClaudeJournalEntry;
    } catch {
      continue;
    }

    if (entry.type !== "user" && entry.type !== "assistant") {
      continue;
    }

    const content = extractText(entry.message?.content);
    if (!content || isManagedInitialPrompt(content, sessionId)) {
      continue;
    }

    turns.push(`${entry.type === "user" ? "You" : "Assistant"}\r\n${toTerminalText(content)}`);
  }

  return trimTranscript(turns.join("\r\n\r\n"));
}

function extractText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .flatMap((block) => {
      if (
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        "text" in block &&
        block.type === "text" &&
        typeof block.text === "string"
      ) {
        return [block.text];
      }
      return [];
    })
    .join("\n");

  return text || undefined;
}

function isManagedInitialPrompt(content: string, sessionId: string): boolean {
  return content.includes(sessionId) && content.includes("Session Write Mode");
}

function toTerminalText(value: string): string {
  return value.replaceAll("\u001b", "").replace(/\r?\n/g, "\r\n");
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
