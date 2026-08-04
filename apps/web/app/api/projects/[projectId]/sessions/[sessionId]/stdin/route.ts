import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
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
  const input = await parseInput(request);
  if (input === null) {
    return NextResponse.json({ error: "Terminal input must be valid base64 data." }, { status: 400 });
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

    if (session.status !== "starting" && session.status !== "running") {
      return NextResponse.json({ error: `AI session "${sessionId}" is not running.` }, { status: 409 });
    }

    await tmux.sendTerminalInput(session.tmuxSessionName, input);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to send terminal input." },
      { status: 500 }
    );
  }
}

async function parseInput(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("data" in body) ||
      typeof body.data !== "string" ||
      !body.data ||
      body.data.length > 65_536 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)
    ) {
      return null;
    }

    const decoded = Buffer.from(body.data, "base64").toString("utf8");
    return decoded || null;
  } catch {
    return null;
  }
}

function projectDirectory(projectId: string): string {
  return path.join(dataDirectory, "projects", projectId);
}
