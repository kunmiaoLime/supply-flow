import path from "node:path";
import { FileSessionStore } from "@supply-flow/core/file-session-store";

interface Arguments {
  projectDirectory: string;
  sessionId: string;
  mode: "on" | "off";
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const projectDirectory = path.resolve(arguments_.projectDirectory);
  const projectsDirectory = path.dirname(projectDirectory);
  if (path.basename(projectsDirectory) !== "projects") {
    throw new Error("The project directory must be located beneath a projects directory.");
  }

  const session = await new FileSessionStore(projectDirectory).update(arguments_.sessionId, {
    readOnly: arguments_.mode === "on"
  });
  console.log(`Session ${session.id} write mode is ${session.readOnly ? "on" : "off"}.`);
}

function parseArguments(values: string[]): Arguments {
  const arguments_ = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(
        "Usage: set-project-session-read-only --project-directory <path> --session-id <id> --mode <on|off>"
      );
    }

    arguments_.set(flag, value);
  }

  const projectDirectory = arguments_.get("--project-directory")?.trim();
  const sessionId = arguments_.get("--session-id")?.trim();
  const mode = arguments_.get("--mode")?.trim();
  if (
    !projectDirectory ||
    !sessionId ||
    !/^[A-Za-z0-9_-]+$/.test(sessionId) ||
    (mode !== "on" && mode !== "off") ||
    arguments_.size !== 3
  ) {
    throw new Error(
      "Usage: set-project-session-read-only --project-directory <path> --session-id <id> --mode <on|off>"
    );
  }

  return { projectDirectory, sessionId, mode };
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to update the session write mode.");
  process.exitCode = 1;
});
