import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FilePullRequestStore } from "@supply-flow/core/file-pull-request-store";
import { NextResponse } from "next/server";
import { dataDirectory, projectDirectory } from "../../sessions/session-service";
import { scanEnabledPullRequests, scanTrackedPullRequest } from "../pull-request-monitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface ScanInput {
  url?: string;
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseScanInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Select a tracked pull request to scan." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    if (!input.url) {
      return NextResponse.json(await scanEnabledPullRequests(project));
    }

    const store = new FilePullRequestStore(projectDirectory(project.project_id));
    const current = (await store.list()).find((pullRequest) => pullRequest.url === input.url);
    if (!current) {
      return NextResponse.json(
        { error: "The tracked pull request no longer exists." },
        { status: 404 }
      );
    }

    const pullRequest = await scanTrackedPullRequest(project, current);
    return NextResponse.json({ prs: await store.list(), pullRequest, errors: [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to scan pull requests." },
      { status: 500 }
    );
  }
}

async function parseScanInput(request: Request): Promise<ScanInput | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      ("url" in body && typeof body.url !== "string")
    ) {
      return null;
    }

    const url = "url" in body && typeof body.url === "string" ? body.url.trim() : "";
    return url.length <= 2_048 ? (url ? { url } : {}) : null;
  } catch {
    return null;
  }
}
