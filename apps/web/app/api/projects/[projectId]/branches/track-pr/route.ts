import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ProjectBranch } from "@supply-flow/core/branch";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FilePullRequestStore } from "@supply-flow/core/file-pull-request-store";
import {
  FilePullRequestTemplateStore,
  PullRequestTemplateError,
  type PullRequestTemplate
} from "@supply-flow/core/file-pull-request-template-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import {
  findGitHubPullRequestForBranch,
  GitHubPullRequestError
} from "@supply-flow/core/github-pull-request";
import type { ProjectRecord, ProjectRepository, ProjectTask } from "@supply-flow/core/project";
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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JIRA_HOSTNAME = "limebike.atlassian.net";
const JIRA_ORIGIN = "https://limebike.atlassian.net";
const CONTEXT_FILE = "context.md";
const projectRoot = path.resolve(process.cwd(), "../..");
const pullRequestPromptPath = path.join(projectRoot, "prompts", "create_pull_request.md");
const tmux = new TmuxAdapter();

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface TrackPullRequestInput {
  repositoryLocal: string;
  name: string;
}

interface JiraIssue {
  key: string;
  link: string;
}

class PullRequestWorkflowError extends Error {
  public constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "PullRequestWorkflowError";
  }
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseTrackPullRequestInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Select a tracked branch to find its pull request." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const branchStore = new FileBranchStore(projectDirectory(project.project_id));
    const branch = (await branchStore.list()).find((currentBranch) =>
      isSameBranch(currentBranch, toProjectBranch(input))
    );
    if (!branch) {
      return NextResponse.json(
        { error: "Select a branch currently tracked by this project." },
        { status: 400 }
      );
    }

    const repository = project.repos.find(
      (currentRepository) => currentRepository.local === input.repositoryLocal
    );
    if (!repository) {
      return NextResponse.json(
        { error: "Select a repository currently associated with this project." },
        { status: 400 }
      );
    }

    try {
      const pullRequest = await findGitHubPullRequestForBranch(repository.remote, branch.name);
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
      if (!isMissingPullRequestError(error)) {
        throw error;
      }
    }

    const task = taskForBranch(project, branch);
    const issue = parseJiraIssueLink(task.jira_ticket);
    if (!issue) {
      throw new PullRequestWorkflowError(
        "The branch's Jira task must use a Lime Jira ticket link before a pull request can be created.",
        409
      );
    }
    await requireProjectContext(project.project_id);

    const pullRequestTemplate = await new FilePullRequestTemplateStore(dataDirectory).resolve(
      repository.remote
    );
    const prompt = await pullRequestCreationPrompt(
      project,
      task,
      repository,
      branch,
      issue,
      pullRequestTemplate
    );
    const existingSession =
      (await findOpenBranchSession(project.project_id, repository.local, branch)) ??
      (await findOpenImplementationSession(project.project_id, repository.local, issue));
    if (existingSession) {
      await rememberLastSession(branchStore, branch, existingSession.id);
      await sendAiSessionPrompt(tmux, existingSession.tmuxSessionName, prompt);
      return NextResponse.json(
        {
          creationRequested: true,
          reusedSession: true,
          session: existingSession
        },
        { status: 202 }
      );
    }

    const session = await createProjectSession(project, {
      action: "create-pull-request",
      title: pullRequestSessionTitle(task),
      goal: prompt,
      workspacePath: repository.local,
      additionalWritableDirectories: [projectDirectory(project.project_id)],
      loadProjectContext: true
    });
    await rememberLastSession(branchStore, branch, session.id);
    return NextResponse.json(
      {
        creationRequested: true,
        reusedSession: false,
        session
      },
      { status: 202 }
    );
  } catch (error) {
    return trackPullRequestErrorResponse(error);
  }
}

async function parseTrackPullRequestInput(request: Request): Promise<TrackPullRequestInput | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("repositoryLocal" in body) ||
      !("name" in body) ||
      typeof body.repositoryLocal !== "string" ||
      typeof body.name !== "string"
    ) {
      return null;
    }

    const repositoryLocal = body.repositoryLocal.trim();
    const name = body.name.trim();
    if (
      !repositoryLocal ||
      repositoryLocal.length > 4_096 ||
      !name ||
      name.length > 255
    ) {
      return null;
    }

    return { repositoryLocal, name };
  } catch {
    return null;
  }
}

function toProjectBranch(input: TrackPullRequestInput): ProjectBranch {
  return {
    name: input.name,
    repository_local: input.repositoryLocal,
    jira_ticket: null,
    last_session_id: null,
    review_result: null
  };
}

function isSameBranch(first: ProjectBranch, second: ProjectBranch): boolean {
  return first.name === second.name && first.repository_local === second.repository_local;
}

function isMissingPullRequestError(error: unknown): error is GitHubPullRequestError {
  return error instanceof GitHubPullRequestError && error.status === 404;
}

function taskForBranch(project: ProjectRecord, branch: ProjectBranch): ProjectTask {
  if (!branch.jira_ticket) {
    throw new PullRequestWorkflowError(
      "Associate a Jira ticket with this branch before creating a pull request.",
      409
    );
  }

  const task = project.tasks.find((currentTask) => currentTask.jira_ticket === branch.jira_ticket);
  if (!task) {
    throw new PullRequestWorkflowError(
      "The branch's Jira ticket is no longer tracked by this project. Edit the branch to select a tracked task.",
      409
    );
  }

  return task;
}

function parseJiraIssueLink(value: string): JiraIssue | null {
  try {
    const url = new URL(value);
    const match = /^\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)\/?$/.exec(url.pathname);
    const issueKey = match?.[1];
    if (url.protocol !== "https:" || url.hostname !== JIRA_HOSTNAME || !issueKey) {
      return null;
    }

    const key = issueKey.toUpperCase();
    return {
      key,
      link: new URL(`/browse/${key}`, JIRA_ORIGIN).toString()
    };
  } catch {
    return null;
  }
}

async function requireProjectContext(projectId: string): Promise<void> {
  try {
    const metadata = await stat(path.join(projectDirectory(projectId), CONTEXT_FILE));
    if (!metadata.isFile()) {
      throw new PullRequestWorkflowError(
        "Initialize project context before creating a pull request.",
        409
      );
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new PullRequestWorkflowError(
        "Initialize project context before creating a pull request.",
        409
      );
    }

    throw error;
  }
}

async function findOpenImplementationSession(
  projectId: string,
  repositoryLocal: string,
  issue: JiraIssue
): Promise<SessionRecord | null> {
  const store = new FileSessionStore(projectDirectory(projectId));
  const activeTmuxSessions = await getActiveTmuxSessions();
  return (
    (await store.list()).find(
      (session) =>
        (session.status === "starting" || session.status === "running") &&
        activeTmuxSessions.has(session.tmuxSessionName) &&
        session.workspacePath === repositoryLocal &&
        session.goal.includes("Implement the selected Jira ticket") &&
        session.goal.includes(issue.key)
    ) ?? null
  );
}

async function findOpenBranchSession(
  projectId: string,
  repositoryLocal: string,
  branch: ProjectBranch
): Promise<SessionRecord | null> {
  if (!branch.last_session_id) {
    return null;
  }

  const store = new FileSessionStore(projectDirectory(projectId));
  const session = await store.get(branch.last_session_id);
  if (
    !session ||
    (session.status !== "starting" && session.status !== "running") ||
    session.workspacePath !== repositoryLocal
  ) {
    return null;
  }

  return (await getActiveTmuxSessions()).has(session.tmuxSessionName) ? session : null;
}

async function getActiveTmuxSessions(): Promise<Set<string>> {
  try {
    return new Set(await tmux.listSessions());
  } catch {
    return new Set();
  }
}

async function rememberLastSession(
  branchStore: FileBranchStore,
  branch: ProjectBranch,
  sessionId: string
): Promise<void> {
  if (branch.last_session_id === sessionId) {
    return;
  }

  await branchStore.update(branch, {
    ...branch,
    last_session_id: sessionId
  });
}

async function pullRequestCreationPrompt(
  project: ProjectRecord,
  task: ProjectTask,
  repository: ProjectRepository,
  branch: ProjectBranch,
  issue: JiraIssue,
  pullRequestTemplate: PullRequestTemplate | null
): Promise<string> {
  const template = await readFile(pullRequestPromptPath, "utf8");
  const contextPath = path.join(projectDirectory(project.project_id), CONTEXT_FILE);
  const trackerCommand = [
    JSON.stringify(path.join(projectRoot, "node_modules", ".bin", "tsx")),
    JSON.stringify(
      path.join(projectRoot, "apps", "web", "scripts", "track-project-pull-request.ts")
    ),
    "--project-directory",
    JSON.stringify(projectDirectory(project.project_id)),
    "--repository-local",
    JSON.stringify(repository.local),
    "--branch",
    JSON.stringify(branch.name)
  ].join(" ");

  return template
    .replaceAll("<PROJECT_NAME>", JSON.stringify(project.project_name))
    .replaceAll("<PROJECT_ID>", JSON.stringify(project.project_id))
    .replaceAll("<PROJECT_CONTEXT_PATH>", JSON.stringify(contextPath))
    .replaceAll("<TASK_TITLE>", JSON.stringify(task.title))
    .replaceAll("<JIRA_TICKET_URL>", JSON.stringify(issue.link))
    .replaceAll("<JIRA_TICKET_KEY>", JSON.stringify(issue.key))
    .replaceAll("<REPOSITORY_NAME>", JSON.stringify(repository.name))
    .replaceAll("<REPOSITORY_LOCAL>", JSON.stringify(repository.local))
    .replaceAll("<REPOSITORY_REMOTE>", repository.remote ? JSON.stringify(repository.remote) : "none")
    .replaceAll("<BRANCH_NAME>", JSON.stringify(branch.name))
    .replaceAll(
      "<PR_TEMPLATE_SOURCE>",
      pullRequestTemplate
        ? JSON.stringify(pullRequestTemplate.path)
        : "No local PR template is configured for this repository."
    )
    .replaceAll("<PR_TEMPLATE_CONTENT>", pullRequestTemplate?.content ?? "")
    .replaceAll("<PULL_REQUEST_TRACKER_COMMAND>", trackerCommand);
}

function pullRequestSessionTitle(task: ProjectTask): string {
  return `Create PR: ${task.title}`.slice(0, 120);
}

function trackPullRequestErrorResponse(error: unknown): NextResponse {
  if (
    error instanceof PullRequestWorkflowError ||
    error instanceof ProjectSessionError ||
    error instanceof GitHubPullRequestError ||
    error instanceof PullRequestTemplateError
  ) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (
    error instanceof Error &&
    error.message === "This pull request is already tracked for the project."
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  return NextResponse.json(
    {
      error:
        error instanceof Error ? error.message : "Unable to find or create the branch pull request."
    },
    { status: 500 }
  );
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
