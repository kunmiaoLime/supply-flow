import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectBranch } from "@supply-flow/core/branch";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import {
  listGitBranches,
  RepositoryBranchError
} from "@supply-flow/core/repository-discovery";
import {
  AiProviderIdSchema,
  ReasoningEffortSchema,
  supportsReasoningEffort,
  type ResolvedAiSessionActionSettings
} from "@supply-flow/core/ai-model-settings";
import type { ProjectRecord, ProjectRepository, ProjectTask } from "@supply-flow/core/project";
import type { SessionRecord } from "@supply-flow/core/session";
import { sendAiSessionPrompt } from "@supply-flow/core/session-prompt";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import { NextResponse } from "next/server";
import { z } from "zod";
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
const reviewPromptPath = path.join(projectRoot, "prompts", "review_branch.md");
const tmux = new TmuxAdapter();

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface ReviewBranchInput {
  repositoryLocal: string;
  name: string;
  sessionConfiguration?: ResolvedAiSessionActionSettings;
}

interface JiraIssue {
  key: string;
  link: string;
}

class ReviewWorkflowError extends Error {
  public constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ReviewWorkflowError";
  }
}

const ReviewSessionConfigurationSchema = z
  .object({
    providerId: AiProviderIdSchema,
    model: z.string().trim().min(1).max(120).nullable(),
    reasoningEffort: ReasoningEffortSchema.nullable(),
    readOnly: z.boolean(),
    yoloMode: z.boolean()
  })
  .superRefine((configuration, context) => {
    if (!supportsReasoningEffort(configuration.providerId, configuration.reasoningEffort)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The reasoning effort is not supported by the selected AI provider.",
        path: ["reasoningEffort"]
      });
    }
  });

export async function GET(request: Request, context: ProjectRouteContext) {
  const input = parseReviewBranchQuery(request);
  if (!input) {
    return NextResponse.json(
      { error: "Select a tracked branch to view its review." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const branch = await findTrackedBranch(project, input);
    const review = await loadReviewResult(project.project_id, branch);
    const session = await findOpenReviewSession(project.project_id, branch);
    return NextResponse.json({
      branch,
      review: review.content === null ? null : { content: review.content, filename: branch.review_result },
      ...(review.error ? { reviewError: review.error } : {}),
      session
    });
  } catch (error) {
    return reviewWorkflowErrorResponse(error);
  }
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseReviewBranchInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Select a tracked branch to review." },
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
    const branch = await findTrackedBranch(project, input, branchStore);
    const repository = project.repos.find(
      (candidate) => candidate.local === branch.repository_local
    );
    if (!repository) {
      throw new ReviewWorkflowError(
        "The branch repository is no longer associated with this project.",
        409
      );
    }

    const task = taskForBranch(project, branch);
    const issue = parseJiraIssueLink(task.jira_ticket);
    if (!issue) {
      throw new ReviewWorkflowError(
        "The branch's Jira task must use a Lime Jira ticket link before code can be reviewed.",
        409
      );
    }

    const activeReviewSession = await findOpenReviewSession(project.project_id, branch);
    if (activeReviewSession) {
      const reviewResult = reviewResultFilename(branch.name);
      await sendAiSessionPrompt(
        tmux,
        activeReviewSession.tmuxSessionName,
        `Run another independent review now. Do not merely repeat or summarize the prior review. ${await buildReviewGoal(
          project,
          task,
          repository,
          branch,
          issue,
          reviewResult
        )}`
      );
      const updatedBranch =
        branch.last_session_id === activeReviewSession.id
          ? branch
          : await branchStore.update(branch, {
              ...branch,
              last_session_id: activeReviewSession.id
            });
      return NextResponse.json(
        {
          branch: updatedBranch,
          reviewRequested: true,
          reusedSession: true,
          session: activeReviewSession
        },
        { status: 200 }
      );
    }

    const localBranches = await listGitBranches(repository.local);
    if (!localBranches.includes(branch.name)) {
      throw new ReviewWorkflowError(
        "The tracked branch is not available in the associated local repository.",
        409
      );
    }

    const reviewResult = reviewResultFilename(branch.name);
    const session = await createProjectSession(project, {
      action: "review-code",
      title: `Review: ${task.title}`.slice(0, 120),
      goal: await buildReviewGoal(project, task, repository, branch, issue, reviewResult),
      workspacePath: repository.local,
      additionalWritableDirectories: [projectDirectory(project.project_id)],
      loadProjectContext: true,
      sessionConfiguration: input.sessionConfiguration
    });
    const updatedBranch = await branchStore.update(branch, {
      ...branch,
      last_session_id: session.id
    });

    return NextResponse.json(
      { branch: updatedBranch, reviewRequested: true, reusedSession: false, session },
      { status: 201 }
    );
  } catch (error) {
    return reviewWorkflowErrorResponse(error);
  }
}

async function parseReviewBranchInput(request: Request): Promise<ReviewBranchInput | null> {
  try {
    const body: unknown = await request.json();
    const input = parseReviewBranchValue(body);
    if (!input) {
      return null;
    }

    if (typeof body === "object" && body !== null && "sessionConfiguration" in body) {
      const configuration = ReviewSessionConfigurationSchema.safeParse(
        body.sessionConfiguration
      );
      if (!configuration.success) {
        return null;
      }

      return { ...input, sessionConfiguration: configuration.data };
    }

    return input;
  } catch {
    return null;
  }
}

function parseReviewBranchQuery(request: Request): ReviewBranchInput | null {
  const url = new URL(request.url);
  return parseReviewBranchValue({
    name: url.searchParams.get("name"),
    repositoryLocal: url.searchParams.get("repositoryLocal")
  });
}

function parseReviewBranchValue(value: unknown): ReviewBranchInput | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("repositoryLocal" in value) ||
    !("name" in value) ||
    typeof value.repositoryLocal !== "string" ||
    typeof value.name !== "string"
  ) {
    return null;
  }

  const repositoryLocal = value.repositoryLocal.trim();
  const name = value.name.trim();
  if (
    !repositoryLocal ||
    repositoryLocal.length > 4_096 ||
    !name ||
    name.length > 255
  ) {
    return null;
  }

  return { repositoryLocal, name };
}

async function findTrackedBranch(
  project: ProjectRecord,
  input: ReviewBranchInput,
  branchStore = new FileBranchStore(projectDirectory(project.project_id))
): Promise<ProjectBranch> {
  const branch = (await branchStore.list()).find((candidate) => isSameBranch(candidate, input));
  if (!branch) {
    throw new ReviewWorkflowError(
      "The tracked branch no longer exists. Refresh the project and try again.",
      404
    );
  }

  return branch;
}

function taskForBranch(project: ProjectRecord, branch: ProjectBranch): ProjectTask {
  if (!branch.jira_ticket) {
    throw new ReviewWorkflowError(
      "Associate a tracked Jira task with this branch before reviewing its code.",
      409
    );
  }

  const task = project.tasks.find((candidate) => candidate.jira_ticket === branch.jira_ticket);
  if (!task) {
    throw new ReviewWorkflowError(
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

async function buildReviewGoal(
  project: ProjectRecord,
  task: ProjectTask,
  repository: ProjectRepository,
  branch: ProjectBranch,
  issue: JiraIssue,
  reviewResult: string
): Promise<string> {
  const projectPath = projectDirectory(project.project_id);
  const reviewPath = path.join(projectPath, "reviews", reviewResult);
  const trackerCommand = [
    JSON.stringify(path.join(projectRoot, "node_modules", ".bin", "tsx")),
    JSON.stringify(
      path.join(projectRoot, "apps", "web", "scripts", "set-project-branch-review-result.ts")
    ),
    "--project-directory",
    JSON.stringify(projectPath),
    "--repository-local",
    JSON.stringify(repository.local),
    "--branch",
    JSON.stringify(branch.name),
    "--review-result",
    JSON.stringify(reviewResult)
  ].join(" ");
  const template = await readFile(reviewPromptPath, "utf8");

  return template
    .replaceAll("<PROJECT_NAME>", JSON.stringify(project.project_name))
    .replaceAll("<PROJECT_ID>", JSON.stringify(project.project_id))
    .replaceAll("<PROJECT_CONTEXT_PATH>", JSON.stringify(path.join(projectPath, CONTEXT_FILE)))
    .replaceAll("<TASK_TITLE>", JSON.stringify(task.title))
    .replaceAll("<JIRA_TICKET_URL>", JSON.stringify(issue.link))
    .replaceAll("<JIRA_TICKET_KEY>", JSON.stringify(issue.key))
    .replaceAll("<REPOSITORY_NAME>", JSON.stringify(repository.name))
    .replaceAll("<REPOSITORY_LOCAL>", JSON.stringify(repository.local))
    .replaceAll("<REPOSITORY_REMOTE>", repository.remote ? JSON.stringify(repository.remote) : "none")
    .replaceAll("<BRANCH_NAME>", JSON.stringify(branch.name))
    .replaceAll("<REVIEW_RESULT_PATH>", JSON.stringify(reviewPath))
    .replaceAll("<REVIEW_RESULT_FILENAME>", JSON.stringify(reviewResult))
    .replaceAll("<REVIEW_RESULT_TRACKER_COMMAND>", trackerCommand);
}

function reviewResultFilename(branchName: string): string {
  const slug = branchName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return `review-${slug || "branch"}-${randomUUID().replaceAll("-", "")}.md`;
}

async function loadReviewResult(
  projectId: string,
  branch: ProjectBranch
): Promise<{ content: string | null; error: string | null }> {
  if (!branch.review_result) {
    return { content: null, error: null };
  }
  if (!isReviewResultFilename(branch.review_result)) {
    return {
      content: null,
      error: "The stored review result filename is invalid."
    };
  }

  try {
    return {
      content: await readFile(
        path.join(projectDirectory(projectId), "reviews", branch.review_result),
        "utf8"
      ),
      error: null
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        content: null,
        error: "The stored review result file is no longer available."
      };
    }

    throw error;
  }
}

async function findOpenReviewSession(
  projectId: string,
  branch: ProjectBranch
): Promise<SessionRecord | null> {
  const activeTmuxSessions = await activeTmuxSessionNames();
  if (activeTmuxSessions.size === 0) {
    return null;
  }

  const store = new FileSessionStore(projectDirectory(projectId));
  return (
    (await store.list()).find(
      (session) =>
        (session.status === "starting" || session.status === "running") &&
        activeTmuxSessions.has(session.tmuxSessionName) &&
        session.workspacePath === branch.repository_local &&
        isReviewSessionForBranch(session, branch)
    ) ?? null
  );
}

function isReviewSessionForBranch(session: SessionRecord, branch: ProjectBranch): boolean {
  return (
    session.goal.includes("# Review Branch Implementation") &&
    session.goal.includes(`- Branch to review: ${JSON.stringify(branch.name)}`)
  );
}

async function activeTmuxSessionNames(): Promise<Set<string>> {
  try {
    return new Set(await tmux.listSessions());
  } catch {
    return new Set();
  }
}

function isReviewResultFilename(value: string): boolean {
  return (
    path.basename(value) === value &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,250}\.md$/.test(value)
  );
}

function isSameBranch(branch: ProjectBranch, input: ReviewBranchInput): boolean {
  return branch.name === input.name && branch.repository_local === input.repositoryLocal;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function reviewWorkflowErrorResponse(error: unknown): NextResponse {
  if (error instanceof ReviewWorkflowError || error instanceof ProjectSessionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof RepositoryBranchError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : "Unable to start the branch review."
    },
    { status: 500 }
  );
}
