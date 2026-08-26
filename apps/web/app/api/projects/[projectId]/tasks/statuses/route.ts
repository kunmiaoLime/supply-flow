import { FileProjectStore } from "@supply-flow/core/file-project-store";
import type { ProjectTask, ProjectTaskStatus } from "@supply-flow/core/project";
import { NextResponse } from "next/server";
import {
  createJiraClient,
  JiraRequestError,
  parseLimeJiraIssue,
  toJiraStatusCache,
  type JiraStatusCache,
  type JiraIssueStatus
} from "../jira";
import { dataDirectory } from "../../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface TaskStatusRequestInput {
  jiraTicket: string;
  transitionId?: string;
}

interface TaskStatusResult {
  jiraTicket: string;
  status?: JiraIssueStatus["status"];
  transitions?: JiraIssueStatus["transitions"];
  error?: string;
}

export async function GET(_request: Request, context: ProjectRouteContext) {
  const { projectId } = await context.params;
  const store = new FileProjectStore(dataDirectory);
  const project = await store.get(projectId);
  if (!project) {
    return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
  }
  if (project.tasks.length === 0) {
    return NextResponse.json({ taskStatuses: [] satisfies TaskStatusResult[] });
  }

  try {
    const client = await createJiraClient();
    const taskStatuses = await Promise.all(
      project.tasks.map((task) => readTaskStatus(task, client))
    );
    try {
      await persistTaskStatusCache(store, projectId, taskStatuses);
    } catch {
      // Fresh statuses remain useful even if the local cache cannot be updated.
    }
    return NextResponse.json({ taskStatuses });
  } catch (error) {
    if (error instanceof JiraRequestError) {
      return NextResponse.json({
        taskStatuses: project.tasks.map((task) => ({
          jiraTicket: task.jira_ticket,
          error: error.message
        }))
      });
    }
    return NextResponse.json(
      { error: "Unable to load Jira task statuses." },
      { status: 502 }
    );
  }
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseTaskStatusRequestInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Select a valid Jira task status change." },
      { status: 400 }
    );
  }

  const issue = parseLimeJiraIssue(input.jiraTicket);
  if (!issue) {
    return NextResponse.json({ error: "Select a tracked Lime Jira task." }, { status: 400 });
  }

  const { projectId } = await context.params;
  const store = new FileProjectStore(dataDirectory);
  const project = await store.get(projectId);
  if (!project) {
    return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
  }

  const task = project.tasks.find(
    (candidate) => parseLimeJiraIssue(candidate.jira_ticket)?.key === issue.key
  );
  if (!task) {
    return NextResponse.json(
      { error: "This Jira task is no longer tracked by the project." },
      { status: 404 }
    );
  }

  try {
    const client = await createJiraClient();
    const current = await client.getIssueStatus(issue.key);
    if (!input.transitionId) {
      return NextResponse.json({
        taskStatus: {
          jiraTicket: task.jira_ticket,
          status: current.status,
          transitions: current.transitions
        } satisfies TaskStatusResult
      });
    }

    if (!current.transitions.some((transition) => transition.id === input.transitionId)) {
      return NextResponse.json(
        { error: "That Jira status change is no longer available. Refresh the task status." },
        { status: 409 }
      );
    }

    await client.transitionIssue(issue.key, input.transitionId);
    const updated = await client.getIssueStatus(issue.key);
    await persistTaskStatusCache(store, projectId, [
      {
        jiraTicket: task.jira_ticket,
        status: updated.status
      }
    ]);
    return NextResponse.json({
      taskStatus: {
        jiraTicket: task.jira_ticket,
        status: updated.status,
        transitions: updated.transitions
      } satisfies TaskStatusResult
    });
  } catch (error) {
    if (error instanceof JiraRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Unable to update the Jira task status." },
      { status: 502 }
    );
  }
}

async function persistTaskStatusCache(
  store: FileProjectStore,
  projectId: string,
  statuses: readonly TaskStatusResult[]
): Promise<void> {
  const statusesByIssueKey = new Map(
    statuses.flatMap((taskStatus) => {
      const issue = parseLimeJiraIssue(taskStatus.jiraTicket);
      return issue && taskStatus.status ? [[issue.key, toJiraStatusCache(taskStatus.status)]] : [];
    })
  );
  if (statusesByIssueKey.size === 0) {
    return;
  }

  const currentProject = await store.get(projectId);
  if (!currentProject) {
    return;
  }

  let changed = false;
  const tasks = currentProject.tasks.map((task) => {
    const status = statusForTask(task, statusesByIssueKey);
    if (!status || sameTaskStatus(task.jira_status, status)) {
      return task;
    }
    changed = true;
    return { ...task, jira_status: status };
  });
  if (changed) {
    await store.update(projectId, { tasks });
  }
}

function statusForTask(
  task: ProjectTask,
  statusesByIssueKey: ReadonlyMap<string, JiraStatusCache>
): JiraStatusCache | undefined {
  const issue = parseLimeJiraIssue(task.jira_ticket);
  return issue ? statusesByIssueKey.get(issue.key) : undefined;
}

function sameTaskStatus(
  current: ProjectTaskStatus | undefined,
  next: JiraStatusCache
): boolean {
  return (
    current?.id === next.id &&
    current?.name === next.name &&
    current?.category === next.category &&
    current?.color_name === next.color_name
  );
}

async function readTaskStatus(
  task: ProjectTask,
  client: Awaited<ReturnType<typeof createJiraClient>>
): Promise<TaskStatusResult> {
  const issue = parseLimeJiraIssue(task.jira_ticket);
  if (!issue) {
    return {
      jiraTicket: task.jira_ticket,
      error: "This task does not have a valid Lime Jira ticket link."
    };
  }

  try {
    const status = await client.getIssueCurrentStatus(issue.key);
    return {
      jiraTicket: task.jira_ticket,
      status
    };
  } catch (error) {
    return {
      jiraTicket: task.jira_ticket,
      error:
        error instanceof JiraRequestError
          ? error.message
          : "Unable to load this Jira task status."
    };
  }
}

async function parseTaskStatusRequestInput(
  request: Request
): Promise<TaskStatusRequestInput | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("jiraTicket" in body) ||
      typeof body.jiraTicket !== "string" ||
      ("transitionId" in body && typeof body.transitionId !== "string")
    ) {
      return null;
    }

    const jiraTicket = body.jiraTicket.trim();
    const transitionId =
      "transitionId" in body && typeof body.transitionId === "string"
        ? body.transitionId.trim()
        : undefined;
    if (
      !jiraTicket ||
      jiraTicket.length > 2_048 ||
      (transitionId !== undefined && (!transitionId || transitionId.length > 255))
    ) {
      return null;
    }
    return { jiraTicket, ...(transitionId ? { transitionId } : {}) };
  } catch {
    return null;
  }
}
