import { execFile } from "node:child_process";
import { FileProjectStore } from "@supply-flow/core/file-project-store";
import { NextResponse } from "next/server";
import { dataDirectory } from "../../sessions/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JIRA_ORIGIN = "https://limebike.atlassian.net";
const JIRA_HOSTNAME = "limebike.atlassian.net";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

interface TrackTaskInput {
  jiraTicket: string;
}

interface JiraIssue {
  key: string;
  link: string;
}

class JiraTrackingError extends Error {
  public constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "JiraTrackingError";
  }
}

export async function POST(request: Request, context: ProjectRouteContext) {
  const input = await parseTrackTaskInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Enter a Lime Jira ticket link of 2,048 characters or fewer." },
      { status: 400 }
    );
  }

  const issue = parseJiraIssueLink(input.jiraTicket);
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

    const title = await getJiraIssueTitle(issue.key);
    const updatedProject = await store.update(project.project_id, {
      tasks: [...project.tasks, { title, jira_ticket: issue.link }]
    });
    return NextResponse.json({ project: updatedProject }, { status: 201 });
  } catch (error) {
    if (error instanceof JiraTrackingError) {
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

function jiraTicketKey(value: string): string | null {
  return parseJiraIssueLink(value)?.key ?? null;
}

async function getJiraIssueTitle(issueKey: string): Promise<string> {
  const [email, token] = await Promise.all([
    readKeychainValue("confluence-api-email"),
    readKeychainValue("confluence-api-token")
  ]);
  const authorization = Buffer.from(`${email}:${token}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(
      `${JIRA_ORIGIN}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary`,
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${authorization}`
        },
        redirect: "error"
      }
    );
  } catch {
    throw new JiraTrackingError("Unable to reach Lime Jira. Try again shortly.", 502);
  }

  if (response.status === 401) {
    throw new JiraTrackingError(
      "Lime Jira credentials were rejected. Restore or renew the Keychain credentials.",
      401
    );
  }
  if (response.status === 403) {
    throw new JiraTrackingError(
      "The authenticated account cannot access this Jira ticket.",
      403
    );
  }
  if (response.status === 404) {
    throw new JiraTrackingError(
      "The Jira ticket was not found or is not accessible to the authenticated account.",
      404
    );
  }
  if (!response.ok) {
    throw new JiraTrackingError("Lime Jira could not retrieve this ticket. Try again shortly.", 502);
  }

  const payload: unknown = await response.json().catch(() => null);
  const title = jiraSummary(payload);
  if (!title) {
    throw new JiraTrackingError("Lime Jira returned a ticket without a valid title.", 502);
  }
  if (title.length > 255) {
    throw new JiraTrackingError("The Jira ticket title is longer than 255 characters.", 422);
  }

  return title;
}

async function readKeychainValue(service: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "security",
      ["find-generic-password", "-s", service, "-w"],
      { encoding: "utf8", maxBuffer: 8_192 },
      (error, stdout) => {
        const value = stdout.trim();
        if (error || !value) {
          reject(
            new JiraTrackingError(
              "Lime Jira credentials are unavailable. Restore confluence-api-email and confluence-api-token in the macOS Keychain.",
              503
            )
          );
          return;
        }

        resolve(value);
      }
    );
  });
}

function jiraSummary(value: unknown): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("fields" in value) ||
    typeof value.fields !== "object" ||
    value.fields === null ||
    !("summary" in value.fields) ||
    typeof value.fields.summary !== "string"
  ) {
    return null;
  }

  const summary = value.fields.summary.trim();
  return summary || null;
}
