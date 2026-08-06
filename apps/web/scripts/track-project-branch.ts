import { FileBranchStore } from "@supply-flow/core/file-branch-store";

interface Arguments {
  projectDirectory: string;
  repositoryLocal: string;
  branch: string;
  jiraTicket: string;
  sessionId: string;
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const store = new FileBranchStore(arguments_.projectDirectory);
  const trackedBranch = {
    name: arguments_.branch,
    repository_local: arguments_.repositoryLocal,
    jira_ticket: arguments_.jiraTicket,
    last_session_id: arguments_.sessionId,
    review_result: null
  };
  const existing = (await store.list()).find(
    (branch) =>
      branch.name === trackedBranch.name &&
      branch.repository_local === trackedBranch.repository_local
  );
  if (existing?.jira_ticket && existing.jira_ticket !== trackedBranch.jira_ticket) {
    throw new Error(
      `Branch ${trackedBranch.name} is already associated with a different Jira ticket.`
    );
  }

  const result = existing
    ? {
        branch:
          existing.jira_ticket === trackedBranch.jira_ticket &&
          existing.last_session_id === trackedBranch.last_session_id
            ? existing
            : await store.update(existing, trackedBranch),
        created: false
      }
    : await store.ensure(trackedBranch);

  console.log(
    result.created
      ? `Tracked branch ${result.branch.name}.`
      : `Branch ${result.branch.name} is already tracked for ${result.branch.jira_ticket}.`
  );
}

function parseArguments(values: string[]): Arguments {
  const arguments_ = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(
        "Usage: track-project-branch --project-directory <path> --repository-local <path> --branch <name> --jira-ticket <url> --session-id <id>"
      );
    }

    arguments_.set(flag, value);
  }

  const projectDirectory = arguments_.get("--project-directory")?.trim();
  const repositoryLocal = arguments_.get("--repository-local")?.trim();
  const branch = arguments_.get("--branch")?.trim();
  const jiraTicket = arguments_.get("--jira-ticket")?.trim();
  const sessionId = arguments_.get("--session-id")?.trim();
  if (
    !projectDirectory ||
    !repositoryLocal ||
    !branch ||
    !jiraTicket ||
    !sessionId ||
    arguments_.size !== 5
  ) {
    throw new Error(
      "Usage: track-project-branch --project-directory <path> --repository-local <path> --branch <name> --jira-ticket <url> --session-id <id>"
    );
  }

  return { projectDirectory, repositoryLocal, branch, jiraTicket, sessionId };
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to track project branch.");
  process.exitCode = 1;
});
