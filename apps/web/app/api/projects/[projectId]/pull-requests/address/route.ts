import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FilePullRequestStore } from "@supply-flow/core/file-pull-request-store";
import { GitHubPullRequestError } from "@supply-flow/core/github-pull-request";
import { NextResponse } from "next/server";
import {
  dataDirectory,
  ProjectSessionError,
  projectDirectory
} from "../../sessions/session-service";
import {
  PullRequestAddressError,
  startAddressPullRequestSession
} from "./address-pull-request-service";
import { scanTrackedPullRequest } from "../pull-request-monitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const url = await parsePullRequestUrl(request);
  if (!url) {
    return NextResponse.json(
      { error: "Select a tracked pull request to address." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const pullRequestStore = new FilePullRequestStore(projectDirectory(project.project_id));
    const currentPullRequest = (await pullRequestStore.list()).find(
      (pullRequest) => pullRequest.url === url
    );
    if (!currentPullRequest) {
      return NextResponse.json(
        { error: "The tracked pull request no longer exists." },
        { status: 404 }
      );
    }

    const pullRequest = await scanTrackedPullRequest(project, currentPullRequest, {
      autoResolve: false
    });
    return NextResponse.json(await startAddressPullRequestSession(project, pullRequest));
  } catch (error) {
    return pullRequestAddressErrorResponse(error);
  }
}

async function parsePullRequestUrl(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("url" in body) ||
      typeof body.url !== "string"
    ) {
      return null;
    }

    const url = body.url.trim();
    return url.length > 0 && url.length <= 2_048 ? url : null;
  } catch {
    return null;
  }
}

function pullRequestAddressErrorResponse(error: unknown): NextResponse {
  if (
    error instanceof PullRequestAddressError ||
    error instanceof ProjectSessionError ||
    error instanceof GitHubPullRequestError
  ) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Unable to start a session to address pull request issues."
    },
    { status: 500 }
  );
}
