import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ProjectBranch } from "@supply-flow/core/branch";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FilePullRequestStore } from "@supply-flow/core/file-pull-request-store";
import { GitHubPullRequestError } from "@supply-flow/core/github-pull-request";
import type { ProjectRecord, ProjectRepository, ProjectTask } from "@supply-flow/core/project";
import type { ProjectPullRequest } from "@supply-flow/core/pull-request";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import type { SessionRecord } from "@supply-flow/core/session";
import { sendAiSessionPrompt } from "@supply-flow/core/session-prompt";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";
import {
  createProjectSession,
  dataDirectory,
  projectDirectory,
  ProjectSessionError
} from "../../sessions/session-service";
import { scanTrackedPullRequest } from "../pull-request-monitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONTEXT_FILE = "context.md";
const projectRoot = path.resolve(process.cwd(), "../..");
const addressPullRequestPromptPath = path.join(
  projectRoot,
  "prompts",
  "address_pull_request_issues.md"
);
const tmux = new TmuxAdapter();

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

class PullRequestAddressError extends Error {
  public constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "PullRequestAddressError";
  }
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

    const pullRequest = await scanTrackedPullRequest(project, currentPullRequest);
    assertActionablePullRequest(pullRequest);
    await requireProjectContext(project.project_id);

    const repository = project.repos.find(
      (candidate) => candidate.local === pullRequest.repository_local
    );
    if (!repository) {
      throw new PullRequestAddressError(
        "The pull request repository is no longer associated with this project.",
        409
      );
    }

    const branchStore = new FileBranchStore(projectDirectory(project.project_id));
    const branch = (await branchStore.list()).find(
      (candidate) =>
        candidate.repository_local === pullRequest.repository_local &&
        candidate.name === pullRequest.branch
    );
    const task = branch?.jira_ticket
      ? project.tasks.find((candidate) => candidate.jira_ticket === branch.jira_ticket)
      : undefined;
    const prompt = await buildAddressPullRequestPrompt(project, pullRequest, repository, task);
    const existingSession = await findOpenAssociatedSession(
      project.project_id,
      pullRequest,
      branch
    );

    let session: SessionRecord;
    let reusedSession = false;
    if (existingSession) {
      await sendAiSessionPrompt(tmux, existingSession.tmuxSessionName, prompt);
      session = existingSession;
      reusedSession = true;
    } else {
      session = await createProjectSession(project, {
        action: "address-pull-request",
        title: `Address PR #${pullRequest.number}: ${pullRequest.title}`.slice(0, 120),
        goal: prompt,
        workspacePath: repository.local,
        additionalWritableDirectories: [projectDirectory(project.project_id)],
        bypassApprovalsAndSandbox: true,
        loadProjectContext: true,
        readOnlyOffAtStart: true
      });
    }

    const updatedPullRequest = await pullRequestStore.update(pullRequest, {
      ...pullRequest,
      last_session_id: session.id
    });
    if (branch && branch.last_session_id !== session.id) {
      await branchStore.update(branch, {
        ...branch,
        last_session_id: session.id
      });
    }

    return NextResponse.json({ pullRequest: updatedPullRequest, reusedSession, session });
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

function assertActionablePullRequest(pullRequest: ProjectPullRequest): void {
  if (pullRequest.status !== "open" && pullRequest.status !== "draft") {
    throw new PullRequestAddressError(
      "Only an open pull request can be addressed.",
      409
    );
  }
  if (
    pullRequest.unresolved_comment_count === 0 &&
    pullRequest.unreplied_comment_count === 0 &&
    pullRequest.ci_status !== "failure"
  ) {
    throw new PullRequestAddressError(
      "GitHub did not report unresolved or unreplied review comments, or failing CI checks, for this pull request.",
      409
    );
  }
}

async function requireProjectContext(projectId: string): Promise<void> {
  try {
    const metadata = await stat(path.join(projectDirectory(projectId), CONTEXT_FILE));
    if (metadata.isFile()) {
      return;
    }
  } catch {
    // A missing context is the common case and needs the same action from the user.
  }

  throw new PullRequestAddressError(
    "Initialize project context before asking an AI session to address pull request issues.",
    409
  );
}

async function findOpenAssociatedSession(
  projectId: string,
  pullRequest: ProjectPullRequest,
  branch: ProjectBranch | undefined
): Promise<SessionRecord | null> {
  const candidateIds = Array.from(
    new Set(
      [pullRequest.last_session_id, branch?.last_session_id].filter(
        (sessionId): sessionId is string => Boolean(sessionId)
      )
    )
  );
  if (candidateIds.length === 0) {
    return null;
  }

  const activeTmuxSessions = await activeTmuxSessionNames();
  const store = new FileSessionStore(projectDirectory(projectId));
  for (const sessionId of candidateIds) {
    const session = await store.get(sessionId);
    if (
      session &&
      (session.status === "starting" || session.status === "running") &&
      session.workspacePath === pullRequest.repository_local &&
      activeTmuxSessions.has(session.tmuxSessionName)
    ) {
      return session;
    }
  }

  return null;
}

async function activeTmuxSessionNames(): Promise<Set<string>> {
  try {
    return new Set(await tmux.listSessions());
  } catch {
    return new Set();
  }
}

async function buildAddressPullRequestPrompt(
  project: ProjectRecord,
  pullRequest: ProjectPullRequest,
  repository: ProjectRepository,
  task: ProjectTask | undefined
): Promise<string> {
  const template = await readFile(addressPullRequestPromptPath, "utf8");
  const contextPath = path.join(projectDirectory(project.project_id), CONTEXT_FILE);

  return template
    .replaceAll("<PROJECT_NAME>", JSON.stringify(project.project_name))
    .replaceAll("<PROJECT_ID>", JSON.stringify(project.project_id))
    .replaceAll("<PROJECT_CONTEXT_PATH>", JSON.stringify(contextPath))
    .replaceAll("<PULL_REQUEST_URL>", JSON.stringify(pullRequest.url))
    .replaceAll("<PULL_REQUEST_TITLE>", JSON.stringify(pullRequest.title))
    .replaceAll("<PULL_REQUEST_NUMBER>", String(pullRequest.number))
    .replaceAll("<BRANCH_NAME>", JSON.stringify(pullRequest.branch))
    .replaceAll("<PULL_REQUEST_STATUS>", pullRequest.status)
    .replaceAll("<UNRESOLVED_COMMENT_COUNT>", String(pullRequest.unresolved_comment_count))
    .replaceAll("<UNREPLIED_COMMENT_COUNT>", String(pullRequest.unreplied_comment_count))
    .replaceAll("<CI_STATUS>", pullRequest.ci_status)
    .replaceAll("<REPOSITORY_NAME>", JSON.stringify(repository.name))
    .replaceAll("<REPOSITORY_LOCAL>", JSON.stringify(repository.local))
    .replaceAll("<REPOSITORY_REMOTE>", repository.remote ? JSON.stringify(repository.remote) : "none")
    .replaceAll("<TASK_TITLE>", task ? JSON.stringify(task.title) : "No tracked Jira task.")
    .replaceAll(
      "<JIRA_TICKET_URL>",
      task ? JSON.stringify(task.jira_ticket) : "No Jira ticket is associated with this branch."
    );
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
