import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const projectRoot = path.resolve(process.cwd(), "../..");
const dataDirectory = process.env.SUPPLY_FLOW_DATA_DIR ?? path.join(projectRoot, ".supply-flow");

interface SessionRouteContext {
  params: Promise<{ projectId: string; sessionId: string }>;
}

export async function POST(_request: Request, context: SessionRouteContext) {
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
    if (session.status !== "stopped" || !session.contextFile) {
      return NextResponse.json(
        { error: "Only a stopped session with a saved handoff can be closed without terminating it." },
        { status: 409 }
      );
    }
    if ((await store.readContext(session.id)) === null) {
      return NextResponse.json(
        { error: "The saved handoff is unavailable and cannot be closed safely." },
        { status: 409 }
      );
    }

    const updated = await store.update(session.id, { hiddenFromTabs: true });
    return NextResponse.json({ session: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to close the saved session tab." },
      { status: 500 }
    );
  }
}

function projectDirectory(projectId: string): string {
  return path.join(dataDirectory, "projects", projectId);
}
