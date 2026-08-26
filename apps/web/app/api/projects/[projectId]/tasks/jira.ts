import { execFile } from "node:child_process";

const JIRA_ORIGIN = "https://limebike.atlassian.net";
const JIRA_HOSTNAME = "limebike.atlassian.net";

export interface JiraIssue {
  key: string;
  link: string;
}

export interface JiraStatus {
  id: string;
  name: string;
  category: string;
  colorName?: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: JiraStatus;
}

export interface JiraIssueStatus {
  status: JiraStatus;
  transitions: readonly JiraTransition[];
}

export interface JiraStatusCache {
  id: string;
  name: string;
  category: string;
  color_name?: string;
}

export class JiraRequestError extends Error {
  public constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "JiraRequestError";
  }
}

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

export function toJiraStatusCache(status: JiraStatus): JiraStatusCache {
  return {
    id: status.id,
    name: status.name,
    category: status.category,
    ...(status.colorName ? { color_name: status.colorName } : {})
  };
}

export async function createJiraClient(): Promise<JiraClient> {
  const [email, token] = await Promise.all([
    readKeychainValue("confluence-api-email"),
    readKeychainValue("confluence-api-token")
  ]);
  return new JiraClient(Buffer.from(`${email}:${token}`).toString("base64"));
}

export class JiraClient {
  public constructor(private readonly authorization: string) {}

  public async getIssueTitle(issueKey: string): Promise<string> {
    const payload = await this.requestJson(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary`
    );
    const title = jiraSummary(payload);
    if (!title) {
      throw new JiraRequestError("Lime Jira returned a ticket without a valid title.", 502);
    }
    if (title.length > 255) {
      throw new JiraRequestError("The Jira ticket title is longer than 255 characters.", 422);
    }
    return title;
  }

  public async getIssueStatus(issueKey: string): Promise<JiraIssueStatus> {
    const [status, transitions] = await Promise.all([
      this.getIssueCurrentStatus(issueKey),
      this.getIssueTransitions(issueKey)
    ]);
    return { status, transitions };
  }

  public async getIssueCurrentStatus(issueKey: string): Promise<JiraStatus> {
    const issuePayload = await this.requestJson(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status`
    );
    const status = jiraStatusFromIssue(issuePayload);
    if (!status) {
      throw new JiraRequestError("Lime Jira returned an invalid workflow response.", 502);
    }
    return status;
  }

  private async getIssueTransitions(issueKey: string): Promise<readonly JiraTransition[]> {
    const transitionPayload = await this.requestJson(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions?expand=transitions.to`
    );
    const transitions = jiraTransitions(transitionPayload);
    if (!transitions) {
      throw new JiraRequestError("Lime Jira returned an invalid workflow response.", 502);
    }
    return transitions;
  }

  public async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    await this.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
      body: JSON.stringify({ transition: { id: transitionId } }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
  }

  public async transitionIssueToStatus(issueKey: string, statusName: string): Promise<JiraStatus> {
    const issue = await this.getIssueStatus(issueKey);
    if (sameJiraStatusName(issue.status.name, statusName)) {
      return issue.status;
    }

    const transition = issue.transitions.find((candidate) =>
      sameJiraStatusName(candidate.to.name, statusName)
    );
    if (!transition) {
      throw new JiraRequestError(
        `Lime Jira cannot move this ticket from ${issue.status.name} to ${statusName}.`,
        409
      );
    }

    await this.transitionIssue(issueKey, transition.id);
    return this.getIssueCurrentStatus(issueKey);
  }

  private async requestJson(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.request(path, init);
    return response.json().catch(() => {
      throw new JiraRequestError("Lime Jira returned an invalid response. Try again shortly.", 502);
    });
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${JIRA_ORIGIN}${path}`, {
        cache: "no-store",
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${this.authorization}`,
          ...init?.headers
        },
        redirect: "error"
      });
    } catch {
      throw new JiraRequestError("Unable to reach Lime Jira. Try again shortly.", 502);
    }

    if (response.status === 401) {
      throw new JiraRequestError(
        "Lime Jira credentials were rejected. Restore or renew the Keychain credentials.",
        401
      );
    }
    if (response.status === 403) {
      throw new JiraRequestError(
        "The authenticated account cannot access this Jira ticket.",
        403
      );
    }
    if (response.status === 404) {
      throw new JiraRequestError(
        "The Jira ticket was not found or is not accessible to the authenticated account.",
        404
      );
    }
    if (!response.ok) {
      throw new JiraRequestError("Lime Jira could not complete this request. Try again shortly.", 502);
    }

    return response;
  }
}

function jiraSummary(value: unknown): string | null {
  const fields = asRecord(value)?.fields;
  const summary = asString(asRecord(fields)?.summary);
  return summary?.trim() || null;
}

function jiraStatusFromIssue(value: unknown): JiraStatus | null {
  const fields = asRecord(value)?.fields;
  return jiraStatus(asRecord(fields)?.status);
}

function jiraTransitions(value: unknown): JiraTransition[] | null {
  const transitions = asRecord(value)?.transitions;
  if (!Array.isArray(transitions)) {
    return null;
  }

  const parsedTransitions: JiraTransition[] = [];
  for (const transition of transitions) {
    const record = asRecord(transition);
    const id = asString(record?.id);
    const name = asString(record?.name);
    const to = jiraStatus(record?.to);
    if (!id || !name || !to) {
      return null;
    }
    parsedTransitions.push({ id, name, to });
  }
  return parsedTransitions;
}

function jiraStatus(value: unknown): JiraStatus | null {
  const record = asRecord(value);
  const id = asString(record?.id);
  const name = asString(record?.name);
  const category = asRecord(record?.statusCategory);
  const categoryName = asString(category?.name);
  const colorName = asString(category?.colorName);
  if (!id || !name || !categoryName) {
    return null;
  }

  return {
    id,
    name,
    category: categoryName,
    ...(colorName ? { colorName } : {})
  };
}

function sameJiraStatusName(first: string, second: string): boolean {
  return first.trim().toLowerCase() === second.trim().toLowerCase();
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
            new JiraRequestError(
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
