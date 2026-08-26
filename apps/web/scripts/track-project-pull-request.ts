import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FilePullRequestStore } from "@supply-flow/core/file-pull-request-store";
import {
  findGitHubPullRequestForBranch,
  GitHubPullRequestError
} from "@supply-flow/core/github-pull-request";
import { createJiraClient, parseLimeJiraIssue } from "../app/api/projects/[projectId]/tasks/jira";

const execFileAsync = promisify(execFile);

interface Arguments {
  projectDirectory: string;
  repositoryLocal: string;
  branch: string;
  jiraTicket: string;
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const issue = parseLimeJiraIssue(arguments_.jiraTicket);
  if (!issue) {
    throw new Error("The associated Jira ticket must be a Lime Jira ticket link.");
  }
  const pullRequest = await findGitHubPullRequestForBranch(
    await originRemote(arguments_.repositoryLocal),
    arguments_.branch
  );
  const store = new FilePullRequestStore(arguments_.projectDirectory);
  const jira = await createJiraClient();
  const status = await jira.transitionIssueToStatus(issue.key, "In Review");

  try {
    await store.add({
      url: pullRequest.url,
      title: pullRequest.title,
      number: pullRequest.number,
      branch: pullRequest.branch,
      repository_local: arguments_.repositoryLocal
    });
    console.log(`Tracked pull request ${pullRequest.url}.`);
  } catch (error) {
    if (
      error instanceof Error &&
        error.message === "This pull request is already tracked for the project."
    ) {
      console.log(`Pull request ${pullRequest.url} is already tracked.`);
    } else {
      throw error;
    }
  }

  console.log(`Moved Jira ticket ${issue.key} to ${status.name}.`);
}

async function originRemote(repositoryLocal: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repositoryLocal, "remote", "get-url", "origin"],
      { encoding: "utf8", maxBuffer: 1_024 * 1_024 }
    );
    return stdout.trim() || null;
  } catch {
    throw new GitHubPullRequestError(
      "The selected repository needs a GitHub origin remote before its pull request can be tracked."
    );
  }
}

function parseArguments(values: string[]): Arguments {
  const arguments_ = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(
        "Usage: track-project-pull-request --project-directory <path> --repository-local <path> --branch <name> --jira-ticket <url>"
      );
    }

    arguments_.set(flag, value);
  }

  const projectDirectory = arguments_.get("--project-directory")?.trim();
  const repositoryLocal = arguments_.get("--repository-local")?.trim();
  const branch = arguments_.get("--branch")?.trim();
  const jiraTicket = arguments_.get("--jira-ticket")?.trim();
  if (!projectDirectory || !repositoryLocal || !branch || !jiraTicket || arguments_.size !== 4) {
    throw new Error(
      "Usage: track-project-pull-request --project-directory <path> --repository-local <path> --branch <name> --jira-ticket <url>"
    );
  }

  return { projectDirectory, repositoryLocal, branch, jiraTicket };
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to track project pull request.");
  process.exitCode = 1;
});
