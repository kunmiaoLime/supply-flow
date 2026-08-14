import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import {
  prependCodexWriteModeBootstrap,
  sendAiSessionPrompt
} from "@supply-flow/core/session-prompt";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const projectRoot = path.resolve(process.cwd(), "../..");
const dataDirectory = process.env.SUPPLY_FLOW_DATA_DIR ?? path.join(projectRoot, ".supply-flow");
const tmux = new TmuxAdapter();

interface SessionRouteContext {
  params: Promise<{ projectId: string; sessionId: string }>;
}

export async function POST(request: Request, context: SessionRouteContext) {
  const readOnly = await parseReadOnly(request);
  if (readOnly === null) {
    return NextResponse.json({ error: "Read-only mode must be true or false." }, { status: 400 });
  }

  const { projectId, sessionId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const store = new FileSessionStore(projectDirectory(project.project_id));
    const session = await store.get(sessionId);
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

    const updated = await store.update(session.id, { readOnly });
    await sendAiSessionPrompt(
      tmux,
      updated.tmuxSessionName,
      readOnlyModePrompt(readOnly, updated.providerId)
    );
    return NextResponse.json({ session: updated });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update the session read-only mode."
      },
      { status: 500 }
    );
  }
}

async function parseReadOnly(request: Request): Promise<boolean | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("readOnly" in body) ||
      typeof body.readOnly !== "boolean"
    ) {
      return null;
    }

    return body.readOnly;
  } catch {
    return null;
  }
}

function readOnlyModePrompt(readOnly: boolean, providerId: string): string {
  const prompt = `Supply Flow changed this session's local read-only mode to ${
    readOnly ? "on" : "off"
  } and persisted it in the project session index. Reload the current session's readOnly value before any filesystem write and follow the repository-local write-mode policy.`;

  return providerId === "codex" && !readOnly
    ? prependCodexWriteModeBootstrap(prompt)
    : prompt;
}

function projectDirectory(projectId: string): string {
  return path.join(dataDirectory, "projects", projectId);
}
