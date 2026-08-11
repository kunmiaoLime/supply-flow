import { open } from "node:fs/promises";
import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import type { SessionRecord } from "@supply-flow/core/session";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const projectRoot = path.resolve(process.cwd(), "../..");
const dataDirectory = process.env.SUPPLY_FLOW_DATA_DIR ?? path.join(projectRoot, ".supply-flow");
const tmux = new TmuxAdapter();
const TERMINAL_OUTPUT_LIMIT = 64 * 1_024;

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
    const output = await readTerminalOutput(
      terminalLogPath(project.project_id, session.id),
      outputOffsetFromRequest(request)
    );
    return NextResponse.json({ ...output, session });
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
): Promise<SessionRecord> {
  if (session.status !== "starting" && session.status !== "running") {
    return session;
  }

  try {
    const activeSessions = await tmux.listSessions();
    if (activeSessions.includes(session.tmuxSessionName)) {
      return session;
    }
  } catch {
    // tmux returns an error when no server is running, which means this session stopped.
  }

  const stopped = await store.update(session.id, { status: "stopped" });
  await store.appendEvent({
    schemaVersion: 1,
    sessionId: session.id,
    timestamp: stopped.updatedAt,
    type: "stopped",
    message: `tmux session ${session.tmuxSessionName} is no longer active.`
  });
  return stopped;
}

async function readTerminalOutput(
  filePath: string,
  requestedOffset: number | undefined
): Promise<{
  output: string;
  outputOffset: number;
  outputSize: number;
  outputTruncated: boolean;
}> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(filePath, "r");
    const size = (await handle.stat()).size;
    let start = requestedOffset ?? Math.max(0, size - TERMINAL_OUTPUT_LIMIT);
    let outputTruncated = false;

    if (start > size || size - start > TERMINAL_OUTPUT_LIMIT) {
      start = Math.max(0, size - TERMINAL_OUTPUT_LIMIT);
      outputTruncated = true;
    }

    const output = Buffer.alloc(size - start);
    await handle.read(output, 0, output.length, start);
    return {
      output: output.toString("utf8").replaceAll("\u0000", ""),
      outputOffset: start,
      outputSize: size,
      outputTruncated
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        output: "",
        outputOffset: 0,
        outputSize: 0,
        outputTruncated: false
      };
    }

    throw error;
  } finally {
    await handle?.close();
  }
}

function outputOffsetFromRequest(request: Request): number | undefined {
  const offset = new URL(request.url).searchParams.get("offset");
  if (offset === null || !/^\d+$/.test(offset)) {
    return undefined;
  }

  const parsedOffset = Number(offset);
  return Number.isSafeInteger(parsedOffset) ? parsedOffset : undefined;
}

function projectDirectory(projectId: string): string {
  return path.join(dataDirectory, "projects", projectId);
}

function terminalLogPath(projectId: string, sessionId: string): string {
  return path.join(projectDirectory(projectId), "sessions", sessionId, "terminal.log");
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
