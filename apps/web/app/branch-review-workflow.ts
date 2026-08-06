import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  ProjectBranch,
  ProjectBranchReviewSessionConfiguration
} from "@supply-flow/core/branch";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import { FileSessionStore } from "@supply-flow/core/file-session-store";
import type {
  ResolvedAiSessionActionSettings
} from "@supply-flow/core/ai-model-settings";
import type { ProjectRecord, ProjectRepository, ProjectTask } from "@supply-flow/core/project";
import type { SessionRecord } from "@supply-flow/core/session";
import { sendAiSessionPrompt } from "@supply-flow/core/session-prompt";
import { TmuxAdapter } from "@supply-flow/core/tmux";
import {
  createProjectSession,
  projectDirectory,
  projectRoot
} from "./api/projects/[projectId]/sessions/session-service";

const CONTEXT_FILE = "context.md";
const JIRA_HOSTNAME = "limebike.atlassian.net";
const JIRA_ORIGIN = "https://limebike.atlassian.net";
const reviewPromptPath = path.join(projectRoot, "prompts", "review_branch.md");
const resolveReviewPromptPath = path.join(projectRoot, "prompts", "resolve_review_findings.md");
const workflowScriptPath = path.join(
  projectRoot,
  "apps",
  "web",
  "scripts",
  "advance-project-branch-review.ts"
);
const tsxPath = path.join(projectRoot, "node_modules", ".bin", "tsx");

export interface JiraIssue {
  key: string;
  link: string;
}

export interface BranchReviewContext {
  project: ProjectRecord;
  branch: ProjectBranch;
  repository: ProjectRepository;
  task: ProjectTask;
  issue: JiraIssue;
}

export interface ReviewSessionRequest {
  branch: ProjectBranch;
  session: SessionRecord;
  reusedSession: boolean;
}

const tmux = new TmuxAdapter();

export function parseLimeJiraIssue(value: string): JiraIssue | null {
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

export function reviewResultFilename(branchName: string): string {
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

export function isReviewResultFilename(value: string): boolean {
  return (
    path.basename(value) === value &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,250}\.md$/.test(value)
  );
}

export function branchReviewContext(
  project: ProjectRecord,
  branch: ProjectBranch
): BranchReviewContext {
  const repository = project.repos.find(
    (candidate) => candidate.local === branch.repository_local
  );
  if (!repository) {
    throw new Error("The branch repository is no longer associated with this project.");
  }
  if (!branch.jira_ticket) {
    throw new Error("Associate a tracked Jira task with this branch before reviewing its code.");
  }

  const task = project.tasks.find((candidate) => candidate.jira_ticket === branch.jira_ticket);
  if (!task) {
    throw new Error(
      "The branch's Jira ticket is no longer tracked by this project. Edit the branch to select a tracked task."
    );
  }

  const issue = parseLimeJiraIssue(task.jira_ticket);
  if (!issue) {
    throw new Error(
      "The branch's Jira task must use a Lime Jira ticket link before code can be reviewed."
    );
  }

  return { project, branch, repository, task, issue };
}

export async function buildReviewGoal(
  context: BranchReviewContext,
  reviewResult: string
): Promise<string> {
  const projectPath = projectDirectory(context.project.project_id);
  const reviewPath = path.join(projectPath, "reviews", reviewResult);
  const template = await readFile(reviewPromptPath, "utf8");

  return template
    .replaceAll("<PROJECT_NAME>", JSON.stringify(context.project.project_name))
    .replaceAll("<PROJECT_ID>", JSON.stringify(context.project.project_id))
    .replaceAll("<PROJECT_CONTEXT_PATH>", JSON.stringify(path.join(projectPath, CONTEXT_FILE)))
    .replaceAll("<TASK_TITLE>", JSON.stringify(context.task.title))
    .replaceAll("<JIRA_TICKET_URL>", JSON.stringify(context.issue.link))
    .replaceAll("<JIRA_TICKET_KEY>", JSON.stringify(context.issue.key))
    .replaceAll("<REPOSITORY_NAME>", JSON.stringify(context.repository.name))
    .replaceAll("<REPOSITORY_LOCAL>", JSON.stringify(context.repository.local))
    .replaceAll(
      "<REPOSITORY_REMOTE>",
      context.repository.remote ? JSON.stringify(context.repository.remote) : "none"
    )
    .replaceAll("<BRANCH_NAME>", JSON.stringify(context.branch.name))
    .replaceAll("<REVIEW_RESULT_PATH>", JSON.stringify(reviewPath))
    .replaceAll("<REVIEW_RESULT_FILENAME>", JSON.stringify(reviewResult))
    .replaceAll(
      "<REVIEW_PASSED_COMMAND>",
      workflowCommand(context, "review-passed", reviewResult)
    )
    .replaceAll(
      "<REVIEW_ISSUES_FOUND_COMMAND>",
      workflowCommand(context, "review-issues-found", reviewResult)
    );
}

export async function buildResolveReviewGoal(context: BranchReviewContext): Promise<string> {
  if (!context.branch.review_result || !isReviewResultFilename(context.branch.review_result)) {
    throw new Error("A valid review result is required before review issues can be resolved.");
  }

  const projectPath = projectDirectory(context.project.project_id);
  const template = await readFile(resolveReviewPromptPath, "utf8");

  return template
    .replaceAll("<PROJECT_NAME>", JSON.stringify(context.project.project_name))
    .replaceAll("<PROJECT_ID>", JSON.stringify(context.project.project_id))
    .replaceAll("<PROJECT_CONTEXT_PATH>", JSON.stringify(path.join(projectPath, CONTEXT_FILE)))
    .replaceAll("<TASK_TITLE>", JSON.stringify(context.task.title))
    .replaceAll("<JIRA_TICKET_URL>", JSON.stringify(context.issue.link))
    .replaceAll("<JIRA_TICKET_KEY>", JSON.stringify(context.issue.key))
    .replaceAll("<REPOSITORY_NAME>", JSON.stringify(context.repository.name))
    .replaceAll("<REPOSITORY_LOCAL>", JSON.stringify(context.repository.local))
    .replaceAll(
      "<REPOSITORY_REMOTE>",
      context.repository.remote ? JSON.stringify(context.repository.remote) : "none"
    )
    .replaceAll("<BRANCH_NAME>", JSON.stringify(context.branch.name))
    .replaceAll(
      "<REVIEW_RESULT_PATH>",
      JSON.stringify(path.join(projectPath, "reviews", context.branch.review_result))
    )
    .replaceAll("<CODE_COMPLETE_COMMAND>", workflowCommand(context, "code-complete"));
}

export async function requestReviewSession(
  context: BranchReviewContext,
  sessionConfiguration?: ResolvedAiSessionActionSettings
): Promise<ReviewSessionRequest> {
  const reviewResult = reviewResultFilename(context.branch.name);
  const goal = await buildReviewGoal(context, reviewResult);
  const activeSession = await findActiveReviewSession(
    context.project.project_id,
    context.branch
  );
  let session: SessionRecord;
  let reusedSession: boolean;

  if (activeSession) {
    await sendAiSessionPrompt(
      tmux,
      activeSession.tmuxSessionName,
      `Run another independent review now. Do not merely repeat or summarize the prior review.\n\n${goal}`
    );
    session = activeSession;
    reusedSession = true;
  } else {
    session = await createProjectSession(context.project, {
      action: "review-code",
      title: `Review: ${context.task.title}`.slice(0, 120),
      goal,
      workspacePath: context.repository.local,
      additionalWritableDirectories: [projectDirectory(context.project.project_id)],
      loadProjectContext: true,
      sessionConfiguration:
        sessionConfiguration ??
        reviewSessionConfigurationForBranch(context.branch) ??
        (await configurationForSession(
          context.project.project_id,
          context.branch.review_session_id
        ))
    });
    reusedSession = false;
  }

  const branchStore = new FileBranchStore(projectDirectory(context.project.project_id));
  const branch = await branchStore.update(context.branch, {
    ...context.branch,
    review_session_id: session.id,
    last_session_id: session.id,
    review_state: "reviewing"
  });

  return { branch, session, reusedSession };
}

function reviewSessionConfigurationForBranch(
  branch: ProjectBranch
): ResolvedAiSessionActionSettings | undefined {
  return branch.review_session_configuration
    ? fromBranchSessionConfiguration(branch.review_session_configuration)
    : undefined;
}

export function implementationSessionConfigurationForBranch(
  branch: ProjectBranch
): ResolvedAiSessionActionSettings | undefined {
  return branch.implementation_session_configuration
    ? fromBranchSessionConfiguration(branch.implementation_session_configuration)
    : undefined;
}

function fromBranchSessionConfiguration(
  configuration: ProjectBranchReviewSessionConfiguration
): ResolvedAiSessionActionSettings {
  return {
    providerId: configuration.provider_id,
    model: configuration.model,
    reasoningEffort: configuration.reasoning_effort,
    readOnly: configuration.read_only,
    yoloMode: configuration.yolo_mode
  };
}

export async function findActiveSession(
  projectId: string,
  sessionId: string | null,
  repositoryLocal: string
): Promise<SessionRecord | null> {
  if (!sessionId) {
    return null;
  }

  const store = new FileSessionStore(projectDirectory(projectId));
  const session = await store.get(sessionId);
  if (
    !session ||
    (session.status !== "starting" && session.status !== "running") ||
    session.workspacePath !== repositoryLocal
  ) {
    return null;
  }

  try {
    const activeTmuxSessions = new Set(await tmux.listSessions());
    return activeTmuxSessions.has(session.tmuxSessionName) ? session : null;
  } catch {
    return null;
  }
}

export async function findActiveImplementationSession(
  projectId: string,
  branch: ProjectBranch
): Promise<SessionRecord | null> {
  const preferredSession = await findActiveSession(
    projectId,
    branch.implementation_session_id,
    branch.repository_local
  );
  if (preferredSession) {
    return preferredSession;
  }

  if (branch.implementation_session_id || !branch.last_session_id) {
    return null;
  }

  const legacySession = await findActiveSession(
    projectId,
    branch.last_session_id,
    branch.repository_local
  );
  return legacySession && isImplementationSession(legacySession) ? legacySession : null;
}

export async function findActiveReviewSession(
  projectId: string,
  branch: ProjectBranch
): Promise<SessionRecord | null> {
  const preferredSession = await findActiveSession(
    projectId,
    branch.review_session_id,
    branch.repository_local
  );
  if (preferredSession) {
    return preferredSession;
  }

  if (branch.review_session_id || !branch.last_session_id) {
    return null;
  }

  const legacySession = await findActiveSession(
    projectId,
    branch.last_session_id,
    branch.repository_local
  );
  return legacySession && isReviewSessionForBranch(legacySession, branch) ? legacySession : null;
}

export async function configurationForSession(
  projectId: string,
  sessionId: string | null
): Promise<ResolvedAiSessionActionSettings | undefined> {
  if (!sessionId) {
    return undefined;
  }

  const session = await new FileSessionStore(projectDirectory(projectId)).get(sessionId);
  if (!session || (session.providerId !== "codex" && session.providerId !== "claude-code")) {
    return undefined;
  }

  return {
    providerId: session.providerId,
    model: session.model ?? null,
    reasoningEffort: session.reasoningEffort ?? null,
    readOnly: session.readOnly ?? false,
    yoloMode: session.yoloMode ?? false
  };
}

function isImplementationSession(session: SessionRecord): boolean {
  return (
    session.goal.includes("# Implement Jira Ticket") ||
    session.goal.includes("# Resolve Branch Review Findings")
  );
}

function isReviewSessionForBranch(session: SessionRecord, branch: ProjectBranch): boolean {
  return (
    session.goal.includes("# Review Branch Implementation") &&
    session.goal.includes(`- Branch to review: ${JSON.stringify(branch.name)}`)
  );
}

function workflowCommand(
  context: BranchReviewContext,
  event: "review-passed" | "review-issues-found" | "code-complete",
  reviewResult?: string
): string {
  return [
    `SUPPLY_FLOW_ROOT=${JSON.stringify(projectRoot)}`,
    JSON.stringify(tsxPath),
    JSON.stringify(workflowScriptPath),
    "--project-directory",
    JSON.stringify(projectDirectory(context.project.project_id)),
    "--repository-local",
    JSON.stringify(context.repository.local),
    "--branch",
    JSON.stringify(context.branch.name),
    "--event",
    event,
    ...(reviewResult ? ["--review-result", JSON.stringify(reviewResult)] : [])
  ].join(" ");
}
