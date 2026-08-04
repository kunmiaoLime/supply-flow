import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitHubPullRequestReference {
  url: string;
  repository: string;
  number: number;
}

export interface GitHubPullRequest extends GitHubPullRequestReference {
  title: string;
  branch: string;
}

interface GitHubPullRequestPayload {
  url: string;
  title: string;
  number: number;
  headRefName: string;
}

export class GitHubPullRequestError extends Error {
  public constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "GitHubPullRequestError";
  }
}

export function parseGitHubPullRequestUrl(value: string): GitHubPullRequestReference | null {
  try {
    const url = new URL(value.trim());
    const parts = url.pathname.split("/").filter(Boolean);
    const [owner, repository, resource, pullRequestNumber] = parts;
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "github.com" ||
      parts.length !== 4 ||
      !owner ||
      !repository ||
      resource !== "pull" ||
      !pullRequestNumber ||
      !/^[1-9]\d*$/.test(pullRequestNumber)
    ) {
      return null;
    }

    const number = Number(pullRequestNumber);
    if (!Number.isSafeInteger(number)) {
      return null;
    }

    return {
      url: `https://github.com/${owner}/${repository}/pull/${number}`,
      repository: `${owner}/${repository}`.toLowerCase(),
      number
    };
  } catch {
    return null;
  }
}

export function githubRepositoryFromRemote(remote: string | null): string | null {
  if (!remote) {
    return null;
  }

  const trimmedRemote = remote.trim();
  if (!trimmedRemote) {
    return null;
  }

  const scpStyleMatch = /^git@github\.com:(.+)$/i.exec(trimmedRemote);
  const repositoryPath = scpStyleMatch
    ? scpStyleMatch[1]
    : githubRemotePathFromUrl(trimmedRemote);
  if (!repositoryPath) {
    return null;
  }

  const parts = repositoryPath.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").split("/");
  const [owner, repository] = parts;
  if (parts.length !== 2 || !owner || !repository) {
    return null;
  }

  return `${owner}/${repository}`.toLowerCase();
}

export async function getGitHubPullRequest(
  reference: GitHubPullRequestReference
): Promise<GitHubPullRequest> {
  const payload = parseGitHubPullRequestPayload(
    await runGh([
      "pr",
      "view",
      reference.url,
      "--json",
      "url,title,number,headRefName"
    ])
  );
  const resolvedReference = parseGitHubPullRequestUrl(payload.url);
  if (
    !resolvedReference ||
    resolvedReference.repository !== reference.repository ||
    resolvedReference.number !== reference.number
  ) {
    throw new GitHubPullRequestError(
      "GitHub returned pull request metadata that does not match the requested link.",
      502
    );
  }

  return {
    ...resolvedReference,
    title: payload.title,
    branch: payload.headRefName
  };
}

export async function findGitHubPullRequestForBranch(
  remote: string | null,
  branch: string
): Promise<GitHubPullRequest> {
  const repository = githubRepositoryFromRemote(remote);
  if (!repository) {
    throw new GitHubPullRequestError(
      "The selected repository needs a GitHub origin remote before its pull request can be tracked."
    );
  }

  const trimmedBranch = branch.trim();
  if (!trimmedBranch) {
    throw new GitHubPullRequestError("Select a branch to track its pull request.");
  }

  const result = await runGh([
    "pr",
    "list",
    "--repo",
    repository,
    "--head",
    trimmedBranch,
    "--state",
    "all",
    "--json",
    "url,title,number,headRefName",
    "--limit",
    "2"
  ]);
  if (!Array.isArray(result)) {
    throw new GitHubPullRequestError("GitHub returned invalid pull request metadata.", 502);
  }

  const pullRequests = result.map(parseGitHubPullRequestPayload);
  if (pullRequests.length === 0) {
    throw new GitHubPullRequestError("No GitHub pull request was found for this branch.", 404);
  }
  if (pullRequests.length > 1) {
    throw new GitHubPullRequestError(
      "Multiple GitHub pull requests were found for this branch. Import the intended pull request link.",
      409
    );
  }

  const pullRequest = pullRequests[0];
  if (!pullRequest) {
    throw new GitHubPullRequestError("GitHub returned invalid pull request metadata.", 502);
  }
  const reference = parseGitHubPullRequestUrl(pullRequest.url);
  if (!reference || reference.repository !== repository) {
    throw new GitHubPullRequestError("GitHub returned invalid pull request metadata.", 502);
  }

  return {
    ...reference,
    title: pullRequest.title,
    branch: pullRequest.headRefName
  };
}

function githubRemotePathFromUrl(remote: string): string | null {
  try {
    const url = new URL(remote);
    return url.hostname.toLowerCase() === "github.com" ? url.pathname : null;
  } catch {
    return null;
  }
}

async function runGh(arguments_: string[]): Promise<unknown> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("gh", arguments_, {
      encoding: "utf8",
      maxBuffer: 1_024 * 1_024
    }));
  } catch {
    throw new GitHubPullRequestError(
      "GitHub CLI could not retrieve the pull request. Check GitHub CLI authentication and repository access.",
      502
    );
  }

  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new GitHubPullRequestError("GitHub returned invalid pull request metadata.", 502);
  }
}

function parseGitHubPullRequestPayload(value: unknown): GitHubPullRequestPayload {
  if (
    typeof value !== "object" ||
    value === null ||
    !("url" in value) ||
    !("title" in value) ||
    !("number" in value) ||
    !("headRefName" in value) ||
    typeof value.url !== "string" ||
    typeof value.title !== "string" ||
    typeof value.number !== "number" ||
    typeof value.headRefName !== "string"
  ) {
    throw new GitHubPullRequestError("GitHub returned invalid pull request metadata.", 502);
  }

  const title = value.title.trim();
  const branch = value.headRefName.trim();
  if (
    !title ||
    title.length > 255 ||
    !branch ||
    branch.length > 255 ||
    !Number.isSafeInteger(value.number) ||
    value.number < 1
  ) {
    throw new GitHubPullRequestError("GitHub returned invalid pull request metadata.", 502);
  }

  return {
    url: value.url,
    title,
    number: value.number,
    headRefName: branch
  };
}
