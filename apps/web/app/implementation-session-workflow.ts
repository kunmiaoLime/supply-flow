import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedAiSessionActionSettings } from "@supply-flow/core/ai-model-settings";
import type { ProjectRecord, ProjectRepository, ProjectTask } from "@supply-flow/core/project";
import { projectDirectory, projectRoot } from "./api/projects/[projectId]/sessions/session-service";

const JIRA_ORIGIN = "https://limebike.atlassian.net";
const JIRA_HOSTNAME = "limebike.atlassian.net";
const implementationPromptPath = path.join(projectRoot, "prompts", "implement_jira_ticket.md");

interface JiraIssue {
  key: string;
  link: string;
}

export function parseImplementationJiraIssue(value: string): JiraIssue | null {
  try {
    const url = new URL(value);
    const match = /^\/browse\/([A-Za-z][A-Za-z0-9]+-\d+)\/?$/.exec(url.pathname);
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

export function implementationSessionTitle(task: ProjectTask, issue: JiraIssue): string {
  const prefix = `[${issue.key}] Implement `;
  return `${prefix}${task.title}`.slice(0, 120);
}

export async function buildImplementationGoal(
  project: ProjectRecord,
  task: ProjectTask,
  repository: ProjectRepository,
  issue: JiraIssue,
  parentBranch: string,
  autoResolve: boolean,
  reviewSessionConfiguration: ResolvedAiSessionActionSettings | undefined,
  instructions?: string
): Promise<string> {
  const contextPath = path.join(projectDirectory(project.project_id), "context.md");
  const branchTrackerCommand = [
    JSON.stringify(path.join(projectRoot, "node_modules", ".bin", "tsx")),
    JSON.stringify(path.join(projectRoot, "apps", "web", "scripts", "track-project-branch.ts")),
    "--project-directory",
    JSON.stringify(projectDirectory(project.project_id)),
    "--repository-local",
    JSON.stringify(repository.local),
    "--branch",
    '"$(git branch --show-current)"',
    "--parent-branch",
    JSON.stringify(parentBranch),
    "--jira-ticket",
    JSON.stringify(issue.link),
    "--session-id",
    JSON.stringify("<AI_SESSION_ID>"),
    "--auto-resolve",
    String(autoResolve),
    ...(reviewSessionConfiguration
      ? [
          "--review-session-configuration",
          JSON.stringify(JSON.stringify(reviewSessionConfiguration))
        ]
      : [])
  ].join(" ");
  const codeCompleteCommand = [
    `SUPPLY_FLOW_ROOT=${JSON.stringify(projectRoot)}`,
    JSON.stringify(path.join(projectRoot, "node_modules", ".bin", "tsx")),
    JSON.stringify(
      path.join(projectRoot, "apps", "web", "scripts", "advance-project-branch-review.ts")
    ),
    "--project-directory",
    JSON.stringify(projectDirectory(project.project_id)),
    "--repository-local",
    JSON.stringify(repository.local),
    "--branch",
    '"$(git branch --show-current)"',
    "--event",
    "code-complete"
  ].join(" ");

  const template = await readFile(implementationPromptPath, "utf8");

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
    .replaceAll("<PARENT_BRANCH>", JSON.stringify(parentBranch))
    .replaceAll("<AUTO_RESOLVE>", autoResolve ? "enabled" : "disabled")
    .replaceAll("<ADDITIONAL_INSTRUCTIONS>", JSON.stringify(instructions || "None provided."))
    .replaceAll("<BRANCH_TRACKER_COMMAND>", branchTrackerCommand)
    .replaceAll("<CODE_COMPLETE_COMMAND>", codeCompleteCommand);
}
