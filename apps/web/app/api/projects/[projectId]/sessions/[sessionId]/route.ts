import { open } from "node:fs/promises";
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
const TERMINAL_OUTPUT_LIMIT = 16 * 1_024 * 1_024;

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
      readTerminalOutput(
        terminalLogPath(project.project_id, session.id),
        outputOffsetFromRequest(request)
      ),
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
    let start = requestedOffset ?? 0;
    let outputTruncated = false;

    if (start > size || size - start > TERMINAL_OUTPUT_LIMIT) {
      start = Math.max(0, size - TERMINAL_OUTPUT_LIMIT);
      outputTruncated = start > 0;
    }

    const output = Buffer.alloc(size - start);
    let bytesRead = 0;
    while (bytesRead < output.length) {
      const read = await handle.read(output, bytesRead, output.length - bytesRead, start + bytesRead);
      if (read.bytesRead === 0) {
        break;
      }
      bytesRead += read.bytesRead;
    }

    return {
      output: output.subarray(0, bytesRead).toString("utf8").replaceAll("\u0000", ""),
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

function transcriptRequested(request: Request): boolean {
  return new URL(request.url).searchParams.get("transcript") === "1";
}

function projectDirectory(projectId: string): string {
  return path.join(dataDirectory, "projects", projectId);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
