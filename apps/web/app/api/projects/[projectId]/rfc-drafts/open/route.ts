import { execFile as execFileCallback } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { ProjectRfcDraftPathSchema } from "@supply-flow/core/project";
import { NextResponse } from "next/server";
import { dataDirectory, projectDirectory } from "../../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFile = promisify(execFileCallback);

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function POST(request: Request, context: ProjectRouteContext) {
  if (process.platform !== "darwin") {
    return NextResponse.json(
      { error: "Reviewing an RFC draft locally is only available on macOS." },
      { status: 501 }
    );
  }

  const draftLink = await parseDraftLink(request);
  if (!draftLink) {
    return NextResponse.json({ error: "Choose a valid RFC draft." }, { status: 400 });
  }

  const { projectId } = await context.params;
  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }
    if (
      !project.documents.some(
        (document) => document.type === "rfc-draft" && document.link === draftLink
      )
    ) {
      return NextResponse.json({ error: "Unknown RFC draft." }, { status: 404 });
    }

    const filePath = path.join(projectDirectory(project.project_id), ...draftLink.split("/"));
    const metadata = await stat(filePath);
    if (!metadata.isFile()) {
      return NextResponse.json({ error: "The RFC draft file is unavailable." }, { status: 404 });
    }

    await execFile("open", [filePath], { encoding: "utf8", maxBuffer: 32_768 });
    return NextResponse.json({ opened: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "macOS could not open the RFC draft for review."
      },
      { status: 500 }
    );
  }
}

async function parseDraftLink(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("draftLink" in body) ||
      typeof body.draftLink !== "string"
    ) {
      return null;
    }

    const result = ProjectRfcDraftPathSchema.safeParse(body.draftLink);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
