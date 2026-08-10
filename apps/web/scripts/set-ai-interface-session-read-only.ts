import path from "node:path";
import { FileSessionStore } from "@supply-flow/core/file-session-store";

interface Arguments {
  sessionDirectory: string;
  sessionId: string;
  mode: "on" | "off";
}

const usage =
  "Usage: set-ai-interface-session-read-only --session-directory <path> --session-id <id> --mode <on|off>";

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const sessionDirectory = path.resolve(arguments_.sessionDirectory);
  const settingsDirectory = path.dirname(sessionDirectory);
  if (
    path.basename(sessionDirectory) !== "ai-interface-sessions" ||
    path.basename(settingsDirectory) !== "settings"
  ) {
    throw new Error("The AI interface session directory must be located beneath settings.");
  }

  const session = await new FileSessionStore(sessionDirectory).update(arguments_.sessionId, {
    readOnly: arguments_.mode === "on"
  });
  console.log(`Session ${session.id} write mode is ${session.readOnly ? "on" : "off"}.`);
}

function parseArguments(values: string[]): Arguments {
  const arguments_ = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(usage);
    }

    arguments_.set(flag, value);
  }

  const sessionDirectory = arguments_.get("--session-directory")?.trim();
  const sessionId = arguments_.get("--session-id")?.trim();
  const mode = arguments_.get("--mode")?.trim();
  if (
    !sessionDirectory ||
    !sessionId ||
    !/^[A-Za-z0-9_-]+$/.test(sessionId) ||
    (mode !== "on" && mode !== "off") ||
    arguments_.size !== 3
  ) {
    throw new Error(usage);
  }

  return { sessionDirectory, sessionId, mode };
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to update the session write mode.");
  process.exitCode = 1;
});
