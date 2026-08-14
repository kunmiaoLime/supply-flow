import path from "node:path";
import {
  FilePullRequestTemplateStore,
  PullRequestTemplateError
} from "@supply-flow/core/file-pull-request-template-store";
import {
  getGitHubPullRequestDescription,
  GitHubPullRequestError,
  parseGitHubPullRequestUrl
} from "@supply-flow/core/github-pull-request";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const projectRoot = path.resolve(process.cwd(), "../..");
const templatesDirectory = path.join(projectRoot, "templates", "PR");
const MAX_TEMPLATE_LENGTH = 100_000;

export async function GET() {
  try {
    const templates = await pullRequestTemplateStore().list();
    return NextResponse.json({ templates });
  } catch (error) {
    return pullRequestTemplateErrorResponse(error, "Unable to load PR templates.");
  }
}

export async function POST(request: Request) {
  const pullRequestUrl = await parsePullRequestUrl(request);
  if (!pullRequestUrl) {
    return NextResponse.json(
      {
        error:
          "Enter a GitHub pull request link in the form https://github.com/owner/repository/pull/123."
      },
      { status: 400 }
    );
  }

  const reference = parseGitHubPullRequestUrl(pullRequestUrl);
  if (!reference) {
    return NextResponse.json(
      {
        error:
          "Enter a GitHub pull request link in the form https://github.com/owner/repository/pull/123."
      },
      { status: 400 }
    );
  }

  try {
    const content = await getGitHubPullRequestDescription(reference);
    if (!content.trim()) {
      return NextResponse.json(
        { error: "The selected pull request has no description to import as a template." },
        { status: 400 }
      );
    }
    if (content.length > MAX_TEMPLATE_LENGTH) {
      return NextResponse.json(
        { error: "The selected pull request description is too large to import as a template." },
        { status: 400 }
      );
    }

    const template = await pullRequestTemplateStore().create(
      reference.repository,
      content
    );
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return pullRequestTemplateErrorResponse(error, "Unable to import the PR template.");
  }
}

export async function PATCH(request: Request) {
  const input = await parseTemplateUpdate(request);
  if (!input) {
    return NextResponse.json(
      {
        error:
          "Select a repository and enter a non-empty PR template of 100,000 characters or fewer."
      },
      { status: 400 }
    );
  }

  try {
    const template = await pullRequestTemplateStore().update(
      input.repository,
      input.content
    );
    return NextResponse.json({ template });
  } catch (error) {
    return pullRequestTemplateErrorResponse(error, "Unable to save the PR template.");
  }
}

function pullRequestTemplateStore(): FilePullRequestTemplateStore {
  return new FilePullRequestTemplateStore(templatesDirectory);
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

async function parseTemplateUpdate(
  request: Request
): Promise<{ repository: string; content: string } | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("repository" in body) ||
      !("content" in body) ||
      typeof body.repository !== "string" ||
      typeof body.content !== "string"
    ) {
      return null;
    }

    const repository = body.repository.trim();
    const content = body.content;
    return repository && content.trim() && content.length <= MAX_TEMPLATE_LENGTH
      ? { repository, content }
      : null;
  } catch {
    return null;
  }
}

function pullRequestTemplateErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof PullRequestTemplateError || error instanceof GitHubPullRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 }
  );
}
