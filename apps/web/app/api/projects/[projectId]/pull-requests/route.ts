import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FilePullRequestStore } from "@supply-flow/core/file-pull-request-store";
import {
  getGitHubPullRequest,
  githubRepositoryFromRemote,
  GitHubPullRequestError,
  parseGitHubPullRequestUrl
} from "@supply-flow/core/github-pull-request";
import { NextResponse } from "next/server";
import { dataDirectory, projectDirectory } from "../sessions/session-service";
import { scanTrackedPullRequest } from "./pull-request-monitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(_request: Request, context: ProjectRouteContext) {
  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const prs = await new FilePullRequestStore(projectDirectory(project.project_id)).initialize();
    return NextResponse.json({ prs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load project pull requests." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const url = await parsePullRequestUrl(request);
  if (!url) {
    return NextResponse.json(
      { error: "Enter a GitHub pull request link of 2,048 characters or fewer." },
      { status: 400 }
    );
  }

  const reference = parseGitHubPullRequestUrl(url);
  if (!reference) {
    return NextResponse.json(
      { error: "Enter a GitHub pull request link in the form https://github.com/owner/repository/pull/123." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const repository = project.repos.find(
      (currentRepository) => githubRepositoryFromRemote(currentRepository.remote) === reference.repository
    );
    if (!repository) {
      return NextResponse.json(
        { error: "This pull request does not belong to a GitHub repository associated with this project." },
        { status: 400 }
      );
    }

    const pullRequest = await getGitHubPullRequest(reference);
    const trackedPullRequest = await new FilePullRequestStore(
      projectDirectory(project.project_id)
    ).add({
      url: pullRequest.url,
      title: pullRequest.title,
      number: pullRequest.number,
      branch: pullRequest.branch,
      repository_local: repository.local
    });
    return NextResponse.json({ pullRequest: trackedPullRequest }, { status: 201 });
  } catch (error) {
    return pullRequestErrorResponse(error, "Unable to import the pull request.");
  }
}

export async function DELETE(request: Request, context: ProjectRouteContext) {
  const url = new URL(request.url).searchParams.get("url")?.trim();
  if (!url || url.length > 2_048) {
    return NextResponse.json(
      { error: "Select a tracked pull request to remove." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const deleted = await new FilePullRequestStore(projectDirectory(project.project_id)).remove(url);
    if (!deleted) {
      return NextResponse.json(
        { error: "The tracked pull request no longer exists." },
        { status: 404 }
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return pullRequestErrorResponse(error, "Unable to remove the pull request.");
  }
}

export async function PATCH(request: Request, context: ProjectRouteContext) {
  const input = await parsePullRequestSettingsInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Select a tracked pull request and valid monitoring settings." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const store = new FilePullRequestStore(projectDirectory(project.project_id));
    const current = (await store.list()).find((pullRequest) => pullRequest.url === input.url);
    if (!current) {
      return NextResponse.json(
        { error: "The tracked pull request no longer exists." },
        { status: 404 }
      );
    }

    let pullRequest = await store.update(current, {
      ...current,
      monitoring_enabled: input.monitoringEnabled,
      retry_ci_enabled: input.monitoringEnabled && input.retryCiEnabled,
      auto_resolve_issues: input.monitoringEnabled && input.autoResolveIssues,
      last_ci_retry_at:
        input.monitoringEnabled && input.retryCiEnabled ? current.last_ci_retry_at : null,
      last_ci_retry_error:
        input.monitoringEnabled && input.retryCiEnabled ? current.last_ci_retry_error : null
    });
    let scanError: string | undefined;

    if (input.monitoringEnabled) {
      try {
        pullRequest = await scanTrackedPullRequest(project, pullRequest);
      } catch (error) {
        scanError = error instanceof Error ? error.message : "Unable to scan the pull request.";
      }
    }

    return NextResponse.json({ pullRequest, ...(scanError ? { scanError } : {}) });
  } catch (error) {
    return pullRequestErrorResponse(error, "Unable to update pull request monitoring.");
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

async function parsePullRequestSettingsInput(
  request: Request
): Promise<{
  url: string;
  monitoringEnabled: boolean;
  retryCiEnabled: boolean;
  autoResolveIssues: boolean;
} | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("url" in body) ||
      !("monitoringEnabled" in body) ||
      !("retryCiEnabled" in body) ||
      !("autoResolveIssues" in body) ||
      typeof body.url !== "string" ||
      typeof body.monitoringEnabled !== "boolean" ||
      typeof body.retryCiEnabled !== "boolean" ||
      typeof body.autoResolveIssues !== "boolean"
    ) {
      return null;
    }

    const url = body.url.trim();
    return url.length > 0 && url.length <= 2_048
      ? {
          url,
          monitoringEnabled: body.monitoringEnabled,
          retryCiEnabled: body.retryCiEnabled,
          autoResolveIssues: body.autoResolveIssues
        }
      : null;
  } catch {
    return null;
  }
}

function pullRequestErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof GitHubPullRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (
    error instanceof Error &&
    error.message === "This pull request is already tracked for the project."
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 }
  );
}
