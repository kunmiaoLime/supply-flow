import { readFile } from "node:fs/promises";
import path from "node:path";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import type { ProjectRecord, ProjectRepository, ProjectTask } from "@supply-flow/core/project";
import {
  listGitBranches,
  RepositoryBranchError
} from "@supply-flow/core/repository-discovery";
import { NextResponse } from "next/server";
import {
  createProjectSession,
  dataDirectory,
  projectDirectory,
  ProjectSessionError
} from "../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JIRA_ORIGIN = "https://limebike.atlassian.net";
const JIRA_HOSTNAME = "limebike.atlassian.net";
const MAX_INSTRUCTIONS_LENGTH = 6_000;
const projectRoot = path.resolve(process.cwd(), "../..");
const implementationPromptPath = path.join(projectRoot, "prompts", "implement_jira_ticket.md");

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface ImplementationSessionInput {
  jiraTicket: string;
  repositoryLocal: string;
  parentBranch: string;
  instructions?: string;
}

interface JiraIssue {
  key: string;
  link: string;
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseImplementationSessionInput(request);
  if (!input) {
    return NextResponse.json(
      {
        error:
          "Select a task, repository, and parent branch. Implementation instructions must be 6,000 characters or fewer."
      },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const project = await new FileProjectStore(dataDirectory).get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    const task = project.tasks.find((currentTask) => currentTask.jira_ticket === input.jiraTicket);
    if (!task) {
      return NextResponse.json(
        { error: "Select a task currently tracked by this project." },
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

    const localBranches = await listGitBranches(repository.local);
    if (!localBranches.includes(input.parentBranch)) {
      return NextResponse.json(
        { error: "The selected parent branch is not available in the selected repository." },
        { status: 400 }
      );
    }

    const issue = parseJiraIssueLink(task.jira_ticket);
    if (!issue) {
      return NextResponse.json(
        {
          error:
            "The selected task must use a Lime Jira ticket link in the form https://limebike.atlassian.net/browse/KEY-123."
        },
        { status: 400 }
      );
    }

    const session = await createProjectSession(project, {
      title: implementationSessionTitle(task),
      goal: await buildImplementationGoal(
        project,
        task,
        repository,
        issue,
        input.parentBranch,
        input.instructions
      ),
      workspacePath: repository.local,
      additionalWritableDirectories: [projectDirectory(project.project_id)],
      bypassApprovalsAndSandbox: true,
      loadProjectContext: true,
      readOnlyOffAtStart: true
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectSessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof RepositoryBranchError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to start the implementation session."
      },
      { status: 500 }
    );
  }
}

async function parseImplementationSessionInput(
  request: Request
): Promise<ImplementationSessionInput | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("jiraTicket" in body) ||
      !("repositoryLocal" in body) ||
      !("parentBranch" in body) ||
      typeof body.jiraTicket !== "string" ||
      typeof body.repositoryLocal !== "string" ||
      typeof body.parentBranch !== "string" ||
      ("instructions" in body && typeof body.instructions !== "string")
    ) {
      return null;
    }

    const jiraTicket = body.jiraTicket.trim();
    const repositoryLocal = body.repositoryLocal.trim();
    const parentBranch = body.parentBranch.trim();
    const instructions =
      "instructions" in body && typeof body.instructions === "string"
        ? body.instructions.trim()
        : "";

    if (
      !jiraTicket ||
      jiraTicket.length > 2_048 ||
      !repositoryLocal ||
      repositoryLocal.length > 4_096 ||
      !parentBranch ||
      parentBranch.length > 255 ||
      instructions.length > MAX_INSTRUCTIONS_LENGTH
    ) {
      return null;
    }

    return {
      jiraTicket,
      repositoryLocal,
      parentBranch,
      ...(instructions ? { instructions } : {})
    };
  } catch {
    return null;
  }
}

function parseJiraIssueLink(value: string): JiraIssue | null {
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

function implementationSessionTitle(task: ProjectTask): string {
  const prefix = "Implement: ";
  return `${prefix}${task.title}`.slice(0, 120);
}

async function buildImplementationGoal(
  project: ProjectRecord,
  task: ProjectTask,
  repository: ProjectRepository,
  issue: JiraIssue,
  parentBranch: string,
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
    "--jira-ticket",
    JSON.stringify(issue.link),
    "--session-id",
    JSON.stringify("<AI_SESSION_ID>")
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
    .replaceAll("<ADDITIONAL_INSTRUCTIONS>", JSON.stringify(instructions || "None provided."))
    .replaceAll("<BRANCH_TRACKER_COMMAND>", branchTrackerCommand);
}
