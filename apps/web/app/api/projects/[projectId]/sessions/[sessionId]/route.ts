import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import type { SessionRecord } from "@supply-flow/core/session";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";
import { readSessionTranscript } from "../../../../../terminal-transcript";
import { terminalLogPath } from "../session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const projectRoot = path.resolve(process.cwd(), "../..");
const dataDirectory = process.env.SUPPLY_FLOW_DATA_DIR ?? path.join(projectRoot, ".supply-flow");
const tmux = new TmuxAdapter();
const TERMINAL_SNAPSHOT_LINES = 200;

interface SessionRouteContext {
  params: Promise<{ projectId: string; sessionId: string }>;
}

export async function GET(request: Request, context: SessionRouteContext) {
  const { projectId, sessionId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const store = new FileSessionStore(projectDirectory(project.project_id));
    const current = await store.get(sessionId);
    if (!current) {
      return NextResponse.json({ error: `Unknown AI session "${sessionId}".` }, { status: 404 });
    }

    const session = await reconcileSession(store, current);
    if (!session) {
      return NextResponse.json(
        { error: `AI session "${sessionId}" is no longer running.` },
        { status: 404 }
      );
    }
    const [output, transcript] = await Promise.all([
      readTmuxSnapshot(session.tmuxSessionName),
      transcriptRequested(request)
        ? readSessionTranscript(session, terminalLogPath(project.project_id, session.id))
        : undefined
    ]);
    return NextResponse.json({
      ...output,
      ...(transcript === undefined ? {} : { transcript }),
      session
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load the AI session." },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: SessionRouteContext) {
  const { projectId, sessionId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const store = new FileSessionStore(projectDirectory(project.project_id));
    const current = await store.get(sessionId);
    if (!current) {
      return NextResponse.json({ error: `Unknown AI session "${sessionId}".` }, { status: 404 });
    }

    try {
      await tmux.terminateSession(current.tmuxSessionName);
    } catch {
      // The terminal may have exited on its own before the stop request arrived.
    }

    await store.remove(current.id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to terminate the AI session." },
      { status: 500 }
    );
  }
}

async function reconcileSession(
  store: FileSessionStore,
  session: SessionRecord
): Promise<SessionRecord | null> {
  const activeSessions = await tmux.listSessions();
  if (!activeSessions.includes(session.tmuxSessionName)) {
    await store.remove(session.id);
    return null;
  }

  return session.status === "running"
    ? session
    : store.update(session.id, { lastError: undefined, status: "running" });
}

async function readTmuxSnapshot(sessionName: string): Promise<{
  output: string;
  outputOffset: number;
  outputSize: number;
  outputTruncated: boolean;
  terminalSnapshot: boolean;
}> {
  try {
    return {
      output: toTerminalLines(await tmux.captureOutput(sessionName, TERMINAL_SNAPSHOT_LINES)),
      outputOffset: 0,
      outputSize: 0,
      outputTruncated: true,
      terminalSnapshot: true
    };
  } catch {
    // Keep the prior visible screen if the process exits between reconciliation and capture.
    return {
      output: "",
      outputOffset: 0,
      outputSize: 0,
      outputTruncated: true,
      terminalSnapshot: true
    };
  }
}

function toTerminalLines(value: string): string {
  return value.replace(/(?:\r?\n)+$/, "").replace(/\r?\n/g, "\r\n");
}

function transcriptRequested(request: Request): boolean {
  return new URL(request.url).searchParams.get("transcript") === "1";
}

function projectDirectory(projectId: string): string {
  return path.join(dataDirectory, "projects", projectId);
}
