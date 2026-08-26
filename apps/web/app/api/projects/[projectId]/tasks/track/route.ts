import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { NextResponse } from "next/server";
import {
  createJiraClient,
  JiraRequestError,
  parseLimeJiraIssue,
  toJiraStatusCache
} from "../jira";
import { dataDirectory } from "../../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface TrackTaskInput {
  jiraTicket: string;
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseTrackTaskInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Enter a Lime Jira ticket link of 2,048 characters or fewer." },
      { status: 400 }
    );
  }

  const issue = parseLimeJiraIssue(input.jiraTicket);
  if (!issue) {
    return NextResponse.json(
      { error: "Enter a Lime Jira ticket link in the form https://limebike.atlassian.net/browse/KEY-123." },
      { status: 400 }
    );
  }

  const { projectId } = await context.params;

  try {
    const store = new FileProjectStore(dataDirectory);
    const project = await store.get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
    }

    if (project.tasks.some((task) => jiraTicketKey(task.jira_ticket) === issue.key)) {
      return NextResponse.json(
        { error: "This Jira ticket is already tracked in Task manager." },
        { status: 409 }
      );
    }

    const client = await createJiraClient();
    const [title, status] = await Promise.all([
      client.getIssueTitle(issue.key),
      client.getIssueCurrentStatus(issue.key)
    ]);
    const updatedProject = await store.update(project.project_id, {
      tasks: [
        ...project.tasks,
        {
          title,
          jira_ticket: issue.link,
          jira_status: toJiraStatusCache(status)
        }
      ]
    });
    return NextResponse.json({ project: updatedProject }, { status: 201 });
  } catch (error) {
    if (error instanceof JiraRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Unable to track the Jira ticket." },
      { status: 500 }
    );
  }
}

async function parseTrackTaskInput(request: Request): Promise<TrackTaskInput | null> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("jiraTicket" in body) ||
      typeof body.jiraTicket !== "string"
    ) {
      return null;
    }

    const jiraTicket = body.jiraTicket.trim();
    return jiraTicket.length > 0 && jiraTicket.length <= 2_048 ? { jiraTicket } : null;
  } catch {
    return null;
  }
}

function jiraTicketKey(value: string): string | null {
  return parseLimeJiraIssue(value)?.key ?? null;
}
