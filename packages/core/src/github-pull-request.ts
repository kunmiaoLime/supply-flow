import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ProjectPullRequestCiStatus,
  ProjectPullRequestStatus
} from "@supply-flow/core/pull-request";

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

export interface GitHubPullRequestHealth {
  status: ProjectPullRequestStatus;
  unresolvedCommentCount: number;
  unrepliedCommentCount: number;
  ciStatus: ProjectPullRequestCiStatus;
  ciRetryTargets: readonly GitHubCiRetryTarget[];
}

export interface GitHubCiRetryTarget {
  provider: "circleci" | "github-actions";
  id: string;
}

export interface GitHubReviewThreadComment {
  authorLogin: string | null;
}

export interface GitHubReviewThread {
  isResolved: boolean;
  comments: readonly GitHubReviewThreadComment[];
}

interface GitHubPullRequestPayload {
  url: string;
  title: string;
  number: number;
  headRefName: string;
}

interface GitHubPullRequestDescriptionPayload {
  url: string;
  body: string;
}

interface GitHubPullRequestHealthPayload {
  state: string;
  isDraft: boolean;
  statusCheckRollup: unknown;
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

export async function getGitHubPullRequestDescription(
  reference: GitHubPullRequestReference
): Promise<string> {
  const payload = parseGitHubPullRequestDescriptionPayload(
    await runGh(["pr", "view", reference.url, "--json", "url,body"])
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

  return payload.body;
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

export async function getGitHubPullRequestHealth(
  reference: GitHubPullRequestReference
): Promise<GitHubPullRequestHealth> {
  const healthPayload = parseGitHubPullRequestHealthPayload(
    await runGh([
      "pr",
      "view",
      reference.url,
      "--json",
      "state,isDraft,statusCheckRollup"
    ])
  );

  const [owner, repository] = reference.repository.split("/");
  if (!owner || !repository) {
    throw new GitHubPullRequestError("The pull request repository is invalid.", 400);
  }

  const reviewThreadCounts = await getReviewThreadCounts(owner, repository, reference.number);
  return {
    status: classifyGitHubPullRequestStatus(healthPayload.state, healthPayload.isDraft),
    unresolvedCommentCount: reviewThreadCounts.unresolvedCommentCount,
    unrepliedCommentCount: reviewThreadCounts.unrepliedCommentCount,
    ciStatus: classifyGitHubPullRequestCiStatus(healthPayload.statusCheckRollup),
    ciRetryTargets: getGitHubCiRetryTargets(healthPayload.statusCheckRollup)
  };
}

export async function retryGitHubPullRequestCi(
  reference: GitHubPullRequestReference,
  targets: readonly GitHubCiRetryTarget[]
): Promise<void> {
  if (targets.length === 0) {
    throw new GitHubPullRequestError(
      "The failing CI check does not expose a supported CircleCI workflow or GitHub Actions run to retry.",
      502
    );
  }

  for (const target of targets) {
    if (target.provider === "circleci") {
      await retryCircleCiWorkflow(target.id);
    } else {
      await retryGitHubActionsRun(reference, target.id);
    }
  }
}

export function classifyGitHubPullRequestStatus(
  state: string,
  isDraft: boolean
): ProjectPullRequestStatus {
  const normalizedState = state.trim().toUpperCase();
  if (normalizedState === "OPEN") {
    return isDraft ? "draft" : "open";
  }
  if (normalizedState === "CLOSED") {
    return "closed";
  }
  if (normalizedState === "MERGED") {
    return "merged";
  }
  return "unknown";
}

export function classifyGitHubPullRequestCiStatus(
  statusCheckRollup: unknown
): ProjectPullRequestCiStatus {
  if (!Array.isArray(statusCheckRollup)) {
    return "unknown";
  }

  const checks = statusCheckRollup.filter(
    (check): check is Record<string, unknown> => typeof check === "object" && check !== null
  );
  if (checks.length === 0) {
    return "none";
  }

  let hasPending = false;
  let hasFailure = false;
  let hasUnknown = false;

  for (const check of checks) {
    const values = ciCheckValues(check);
    if (isFailedCiCheckValues(values)) {
      hasFailure = true;
      continue;
    }

    if (isPendingCiCheckValues(values)) {
      hasPending = true;
      continue;
    }

    if (
      !values.every((value) =>
        ["SUCCESS", "NEUTRAL", "SKIPPED", "COMPLETED", "PASSED"].includes(value)
      )
    ) {
      hasUnknown = true;
    }
  }

  if (hasPending) {
    return "pending";
  }
  if (hasFailure) {
    return "failure";
  }
  if (hasUnknown) {
    return "unknown";
  }
  return "success";
}

export function getGitHubCiRetryTargets(
  statusCheckRollup: unknown
): GitHubCiRetryTarget[] {
  if (!Array.isArray(statusCheckRollup)) {
    return [];
  }

  const targets = new Map<string, GitHubCiRetryTarget>();
  for (const check of statusCheckRollup) {
    if (typeof check !== "object" || check === null || !isFailedCiCheckValues(ciCheckValues(check))) {
      continue;
    }

    for (const url of ciCheckUrls(check)) {
      const target = ciRetryTargetFromUrl(url);
      if (target) {
        targets.set(`${target.provider}:${target.id}`, target);
      }
    }
  }

  return [...targets.values()];
}

function ciCheckValues(check: object): string[] {
  const values = [
    "conclusion" in check ? check.conclusion : undefined,
    "status" in check ? check.status : undefined,
    "state" in check ? check.state : undefined
  ];

  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

function isFailedCiCheckValues(values: readonly string[]): boolean {
  return values.some((value) =>
    [
      "FAILURE",
      "ERROR",
      "TIMED_OUT",
      "CANCELLED",
      "ACTION_REQUIRED",
      "STARTUP_FAILURE"
    ].includes(value)
  );
}

function isPendingCiCheckValues(values: readonly string[]): boolean {
  return (
    values.length === 0 ||
    values.some((value) =>
      ["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"].includes(value)
    )
  );
}

function ciCheckUrls(check: object): string[] {
  return ["detailsUrl" in check ? check.detailsUrl : undefined, "targetUrl" in check ? check.targetUrl : undefined]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function ciRetryTargetFromUrl(value: string): GitHubCiRetryTarget | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const circleCiMatch =
      hostname === "app.circleci.com" || hostname === "circleci.com"
        ? /\/(?:workflow|workflows)\/([0-9a-f-]{36})(?:\/|$)/i.exec(url.pathname)
        : null;
    if (circleCiMatch?.[1]) {
      return { provider: "circleci", id: circleCiMatch[1] };
    }

    if (hostname !== "github.com") {
      return null;
    }
    const githubActionsMatch = /^\/[^/]+\/[^/]+\/actions\/runs\/([1-9]\d*)(?:\/|$)/.exec(
      url.pathname
    );
    return githubActionsMatch?.[1]
      ? { provider: "github-actions", id: githubActionsMatch[1] }
      : null;
  } catch {
    return null;
  }
}

export function countUnrepliedGitHubReviewThreads(
  threads: readonly GitHubReviewThread[],
  viewerLogin: string
): number {
  const normalizedViewerLogin = viewerLogin.trim().toLowerCase();
  if (!normalizedViewerLogin) {
    return 0;
  }

  return threads.filter((thread) => {
    let lastViewerComment = -1;
    let lastOtherComment = -1;

    thread.comments.forEach((comment, index) => {
      const authorLogin = comment.authorLogin?.trim().toLowerCase();
      if (!authorLogin) {
        return;
      }
      if (authorLogin === normalizedViewerLogin) {
        lastViewerComment = index;
      } else {
        lastOtherComment = index;
      }
    });

    return lastOtherComment > lastViewerComment;
  }).length;
}

function githubRemotePathFromUrl(remote: string): string | null {
  try {
    const url = new URL(remote);
    return url.hostname.toLowerCase() === "github.com" ? url.pathname : null;
  } catch {
    return null;
  }
}

async function getReviewThreadCounts(
  owner: string,
  repository: string,
  number: number
): Promise<{ unresolvedCommentCount: number; unrepliedCommentCount: number }> {
  let after: string | null = null;
  let viewerLogin: string | null = null;
  const threads: Array<GitHubReviewThread & { id: string; hasMoreComments: boolean }> = [];

  do {
    const result = parseReviewThreadsPayload(
      await runGh([
        "api",
        "graphql",
        "-f",
        `query=${REVIEW_THREADS_QUERY}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `repository=${repository}`,
        "-F",
        `number=${number}`,
        ...(after ? ["-F", `after=${after}`] : [])
      ])
    );

    viewerLogin ??= result.viewerLogin;
    for (const thread of result.nodes) {
      const comments = [...thread.comments];
      if (thread.hasMoreComments) {
        comments.push(...(await getAdditionalReviewThreadComments(thread.id)));
      }
      threads.push({
        ...thread,
        comments
      });
    }
    after = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null;
  } while (after);

  if (!viewerLogin) {
    throw new GitHubPullRequestError("GitHub did not return the authenticated user.", 502);
  }

  return {
    unresolvedCommentCount: threads.filter((thread) => !thread.isResolved).length,
    unrepliedCommentCount: countUnrepliedGitHubReviewThreads(threads, viewerLogin)
  };
}

async function getAdditionalReviewThreadComments(
  reviewThreadId: string
): Promise<GitHubReviewThreadComment[]> {
  let after: string | null = null;
  const comments: GitHubReviewThreadComment[] = [];

  do {
    const result = parseAdditionalReviewThreadCommentsPayload(
      await runGh([
        "api",
        "graphql",
        "-f",
        `query=${REVIEW_THREAD_COMMENTS_QUERY}`,
        "-F",
        `reviewThreadId=${reviewThreadId}`,
        ...(after ? ["-F", `after=${after}`] : [])
      ])
    );
    comments.push(...result.comments);
    after = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null;
  } while (after);

  return comments;
}

async function retryGitHubActionsRun(
  reference: GitHubPullRequestReference,
  runId: string
): Promise<void> {
  await runGhCommand(
    [
      "api",
      "--method",
      "POST",
      `repos/${reference.repository}/actions/runs/${runId}/rerun-failed-jobs`
    ],
    "GitHub CLI could not retry the failing GitHub Actions run. Check GitHub CLI authentication and repository access."
  );
}

async function retryCircleCiWorkflow(workflowId: string): Promise<void> {
  const configuration = await getCircleCiConfiguration();
  let response: Response;
  try {
    response = await fetch(
      new URL(`/api/v2/workflow/${encodeURIComponent(workflowId)}/rerun`, configuration.host),
      {
        body: JSON.stringify({ from_failed: true }),
        headers: {
          "Circle-Token": configuration.token,
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
  } catch {
    throw new GitHubPullRequestError(
      "CircleCI could not be reached to retry the failing workflow. Verify CircleCI access in Settings.",
      502
    );
  }

  if (!response.ok) {
    throw new GitHubPullRequestError(
      "CircleCI did not accept the workflow retry. Verify CircleCI access in Settings.",
      502
    );
  }
}

async function getCircleCiConfiguration(): Promise<{ host: string; token: string }> {
  const environmentToken = process.env.CIRCLECI_CLI_TOKEN?.trim();
  const environmentHost = process.env.CIRCLECI_CLI_HOST?.trim();
  let configurationFile = "";

  try {
    configurationFile = await readFile(path.join(os.homedir(), ".circleci", "cli.yml"), "utf8");
  } catch {
    // An environment token is sufficient and does not require the CLI config file.
  }

  const token = environmentToken ?? circleCiConfigValue(configurationFile, "token");
  if (!token) {
    throw new GitHubPullRequestError(
      "CircleCI authentication is not configured. Set up CircleCI access in Settings before enabling Retry CI.",
      502
    );
  }

  const configuredHost = environmentHost ?? circleCiConfigValue(configurationFile, "host");
  let host: URL;
  try {
    host = new URL(configuredHost || "https://circleci.com");
  } catch {
    throw new GitHubPullRequestError(
      "CircleCI CLI configuration has an invalid host. Set up CircleCI access in Settings.",
      502
    );
  }
  if (host.protocol !== "https:" || host.username || host.password) {
    throw new GitHubPullRequestError(
      "CircleCI CLI configuration has an invalid host. Set up CircleCI access in Settings.",
      502
    );
  }

  return { host: host.origin, token };
}

function circleCiConfigValue(configurationFile: string, key: "host" | "token"): string | null {
  const match = new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, "m").exec(configurationFile);
  if (!match?.[1]) {
    return null;
  }

  const value = match[1].trim();
  if (
    value.length >= 2 &&
    ((value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1).trim() || null;
  }

  return value || null;
}

async function runGh(arguments_: string[]): Promise<unknown> {
  const stdout = await runGhCommand(
    arguments_,
    "GitHub CLI could not retrieve the pull request. Check GitHub CLI authentication and repository access."
  );

  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new GitHubPullRequestError("GitHub returned invalid pull request metadata.", 502);
  }
}

async function runGhCommand(arguments_: string[], errorMessage: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", arguments_, {
      encoding: "utf8",
      maxBuffer: 1_024 * 1_024
    });
    return stdout;
  } catch {
    throw new GitHubPullRequestError(errorMessage, 502);
  }
}

function parseGitHubPullRequestHealthPayload(value: unknown): GitHubPullRequestHealthPayload {
  if (
    typeof value !== "object" ||
    value === null ||
    !("state" in value) ||
    !("isDraft" in value) ||
    !("statusCheckRollup" in value) ||
    typeof value.state !== "string" ||
    typeof value.isDraft !== "boolean"
  ) {
    throw new GitHubPullRequestError("GitHub returned invalid pull request health data.", 502);
  }

  return {
    state: value.state,
    isDraft: value.isDraft,
    statusCheckRollup: value.statusCheckRollup
  };
}

function parseGitHubPullRequestDescriptionPayload(
  value: unknown
): GitHubPullRequestDescriptionPayload {
  if (
    typeof value !== "object" ||
    value === null ||
    !("url" in value) ||
    !("body" in value) ||
    typeof value.url !== "string" ||
    typeof value.body !== "string"
  ) {
    throw new GitHubPullRequestError("GitHub returned invalid pull request metadata.", 502);
  }

  return {
    url: value.url,
    body: value.body
  };
}

function parseReviewThreadsPayload(value: unknown): {
  viewerLogin: string;
  nodes: Array<
    GitHubReviewThread & {
      id: string;
      hasMoreComments: boolean;
    }
  >;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
} {
  if (
    typeof value !== "object" ||
    value === null ||
    !("data" in value) ||
    typeof value.data !== "object" ||
    value.data === null ||
    !("viewer" in value.data) ||
    typeof value.data.viewer !== "object" ||
    value.data.viewer === null ||
    !("login" in value.data.viewer) ||
    typeof value.data.viewer.login !== "string" ||
    !("repository" in value.data) ||
    typeof value.data.repository !== "object" ||
    value.data.repository === null ||
    !("pullRequest" in value.data.repository) ||
    typeof value.data.repository.pullRequest !== "object" ||
    value.data.repository.pullRequest === null ||
    !("reviewThreads" in value.data.repository.pullRequest) ||
    typeof value.data.repository.pullRequest.reviewThreads !== "object" ||
    value.data.repository.pullRequest.reviewThreads === null
  ) {
    throw new GitHubPullRequestError("GitHub returned invalid review thread data.", 502);
  }

  const reviewThreads = value.data.repository.pullRequest.reviewThreads;
  if (
    !("nodes" in reviewThreads) ||
    !("pageInfo" in reviewThreads) ||
    !Array.isArray(reviewThreads.nodes) ||
    typeof reviewThreads.pageInfo !== "object" ||
    reviewThreads.pageInfo === null ||
    !("hasNextPage" in reviewThreads.pageInfo) ||
    !("endCursor" in reviewThreads.pageInfo) ||
    typeof reviewThreads.pageInfo.hasNextPage !== "boolean" ||
    (typeof reviewThreads.pageInfo.endCursor !== "string" &&
      reviewThreads.pageInfo.endCursor !== null)
  ) {
    throw new GitHubPullRequestError("GitHub returned invalid review thread data.", 502);
  }

  const nodes = reviewThreads.nodes.map((thread) => {
    if (
      typeof thread !== "object" ||
      thread === null ||
      !("id" in thread) ||
      !("isResolved" in thread) ||
      !("comments" in thread) ||
      typeof thread.id !== "string" ||
      typeof thread.isResolved !== "boolean" ||
      typeof thread.comments !== "object" ||
      thread.comments === null
    ) {
      throw new GitHubPullRequestError("GitHub returned invalid review thread data.", 502);
    }

    const comments = parseReviewThreadCommentsConnection(thread.comments);
    return {
      id: thread.id,
      isResolved: thread.isResolved,
      comments: comments.comments,
      hasMoreComments: comments.pageInfo.hasNextPage
    };
  });

  return {
    viewerLogin: value.data.viewer.login,
    nodes,
    pageInfo: {
      hasNextPage: reviewThreads.pageInfo.hasNextPage,
      endCursor: reviewThreads.pageInfo.endCursor
    }
  };
}

function parseAdditionalReviewThreadCommentsPayload(value: unknown): {
  comments: GitHubReviewThreadComment[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
} {
  if (
    typeof value !== "object" ||
    value === null ||
    !("data" in value) ||
    typeof value.data !== "object" ||
    value.data === null ||
    !("node" in value.data) ||
    typeof value.data.node !== "object" ||
    value.data.node === null ||
    !("comments" in value.data.node) ||
    typeof value.data.node.comments !== "object" ||
    value.data.node.comments === null
  ) {
    throw new GitHubPullRequestError("GitHub returned invalid review thread data.", 502);
  }

  return parseReviewThreadCommentsConnection(value.data.node.comments);
}

function parseReviewThreadCommentsConnection(value: object): {
  comments: GitHubReviewThreadComment[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
} {
  if (
    !("nodes" in value) ||
    !("pageInfo" in value) ||
    !Array.isArray(value.nodes) ||
    typeof value.pageInfo !== "object" ||
    value.pageInfo === null ||
    !("hasNextPage" in value.pageInfo) ||
    !("endCursor" in value.pageInfo) ||
    typeof value.pageInfo.hasNextPage !== "boolean" ||
    (typeof value.pageInfo.endCursor !== "string" && value.pageInfo.endCursor !== null)
  ) {
    throw new GitHubPullRequestError("GitHub returned invalid review thread data.", 502);
  }

  const comments = value.nodes.map((comment) => {
    if (
      typeof comment !== "object" ||
      comment === null ||
      !("author" in comment) ||
      (typeof comment.author !== "object" && comment.author !== null)
    ) {
      throw new GitHubPullRequestError("GitHub returned invalid review thread data.", 502);
    }

    if (comment.author === null) {
      return { authorLogin: null };
    }
    if (!("login" in comment.author) || typeof comment.author.login !== "string") {
      throw new GitHubPullRequestError("GitHub returned invalid review thread data.", 502);
    }
    return { authorLogin: comment.author.login };
  });

  return {
    comments,
    pageInfo: {
      hasNextPage: value.pageInfo.hasNextPage,
      endCursor: value.pageInfo.endCursor
    }
  };
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

const REVIEW_THREADS_QUERY = `
  query PullRequestReviewThreads(
    $owner: String!
    $repository: String!
    $number: Int!
    $after: String
  ) {
    viewer {
      login
    }
    repository(owner: $owner, name: $repository) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $after) {
          nodes {
            id
            isResolved
            comments(first: 100) {
              nodes {
                author {
                  login
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const REVIEW_THREAD_COMMENTS_QUERY = `
  query PullRequestReviewThreadComments($reviewThreadId: ID!, $after: String) {
    node(id: $reviewThreadId) {
      ... on PullRequestReviewThread {
        comments(first: 100, after: $after) {
          nodes {
            author {
              login
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;
