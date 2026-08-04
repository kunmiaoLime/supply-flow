import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFile = promisify(execFileCallback);
const projectRoot = path.resolve(process.cwd(), "../..");
const dataDirectory = process.env.SUPPLY_FLOW_DATA_DIR ?? path.join(projectRoot, ".supply-flow");
const tmux = new TmuxAdapter();

interface SessionRouteContext {
  params: Promise<{ projectId: string; sessionId: string }>;
}

export async function POST(_request: Request, context: SessionRouteContext) {
  if (process.platform !== "darwin") {
    return NextResponse.json(
      { error: "Opening a native terminal is only available on macOS." },
      { status: 501 }
    );
  }

  const { projectId, sessionId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const session = await new FileSessionStore(projectDirectory(project.project_id)).get(sessionId);
    if (!session) {
      return NextResponse.json({ error: `Unknown AI session "${sessionId}".` }, { status: 404 });
    }

    const activeSessions = await tmux.listSessions();
    if (!activeSessions.includes(session.tmuxSessionName)) {
      return NextResponse.json(
        { error: "This tmux session is no longer running." },
        { status: 409 }
      );
    }

    await openMacOSTerminal(session.tmuxSessionName);
    return NextResponse.json({ opened: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to open the AI session in macOS Terminal."
      },
      { status: 500 }
    );
  }
}

async function openMacOSTerminal(tmuxSessionName: string): Promise<void> {
  if (!/^sf_[A-Za-z0-9_-]+$/.test(tmuxSessionName)) {
    throw new Error("The tmux session name is invalid.");
  }

  try {
    await execFile(
      "osascript",
      [
        "-e",
        `tell application "Terminal"
  activate
  do script "tmux attach -t ${tmuxSessionName}"
end tell`
      ],
      { encoding: "utf8", maxBuffer: 32_768 }
    );
  } catch {
    throw new Error(
      "macOS could not open Terminal. Check that Terminal is available and allow automation if prompted."
    );
  }
}

function projectDirectory(projectId: string): string {
  return path.join(dataDirectory, "projects", projectId);
}
