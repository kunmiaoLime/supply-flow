import { FilePullRequestStore } from "@supply-flow/core/file-pull-request-store";
import {
  getGitHubPullRequestHealth,
  parseGitHubPullRequestUrl,
  retryGitHubPullRequestCi
} from "@supply-flow/core/github-pull-request";
import type { ProjectRecord } from "@supply-flow/core/project";
import type { ProjectPullRequest } from "@supply-flow/core/pull-request";
import { projectDirectory } from "../sessions/session-service";

const CI_RETRY_INTERVAL_MS = 60_000;
const activePullRequestScans = new Map<string, Promise<ProjectPullRequest>>();

export async function scanTrackedPullRequest(
  project: ProjectRecord,
  pullRequest: ProjectPullRequest
): Promise<ProjectPullRequest> {
  const scanKey = `${project.project_id}:${pullRequest.url}`;
  const activeScan = activePullRequestScans.get(scanKey);
  if (activeScan) {
    return activeScan;
  }

  const scan = scanPullRequest(project, pullRequest);
  activePullRequestScans.set(scanKey, scan);
  try {
    return await scan;
  } finally {
    if (activePullRequestScans.get(scanKey) === scan) {
      activePullRequestScans.delete(scanKey);
    }
  }
}

async function scanPullRequest(
  project: ProjectRecord,
  pullRequest: ProjectPullRequest
): Promise<ProjectPullRequest> {
  const reference = parseGitHubPullRequestUrl(pullRequest.url);
  if (!reference) {
    throw new Error("The tracked pull request link is invalid.");
  }

  const health = await getGitHubPullRequestHealth(reference);
  const now = new Date();
  const monitoringEnabled =
    pullRequest.monitoring_enabled &&
    health.status !== "closed" &&
    health.status !== "merged";
  const retryCiEnabled = monitoringEnabled && pullRequest.retry_ci_enabled;
  const shouldRetryCi =
    retryCiEnabled &&
    health.ciStatus === "failure" &&
    (health.status === "open" || health.status === "draft");
  const updatedPullRequest: ProjectPullRequest = {
    ...pullRequest,
    monitoring_enabled: monitoringEnabled,
    retry_ci_enabled: retryCiEnabled,
    status: health.status,
    unresolved_comment_count: health.unresolvedCommentCount,
    unreplied_comment_count: health.unrepliedCommentCount,
    ci_status: health.ciStatus,
    last_scanned_at: now.toISOString(),
    last_ci_retry_at: shouldRetryCi ? pullRequest.last_ci_retry_at : null,
    last_ci_retry_error: shouldRetryCi ? pullRequest.last_ci_retry_error : null
  };

  const store = new FilePullRequestStore(projectDirectory(project.project_id));
  const savedPullRequest = await store.update(
    pullRequest,
    updatedPullRequest
  );
  if (!shouldRetryCi || !isCiRetryDue(savedPullRequest.last_ci_retry_at, now)) {
    return savedPullRequest;
  }

  try {
    await retryGitHubPullRequestCi(reference, health.ciRetryTargets);
    return store.update(savedPullRequest, {
      ...savedPullRequest,
      last_ci_retry_at: now.toISOString(),
      last_ci_retry_error: null
    });
  } catch (error) {
    return store.update(savedPullRequest, {
      ...savedPullRequest,
      last_ci_retry_at: now.toISOString(),
      last_ci_retry_error:
        error instanceof Error ? error.message.slice(0, 4_000) : "Unable to retry failing CI."
    });
  }
}

export async function scanEnabledPullRequests(
  project: ProjectRecord
): Promise<{ prs: ProjectPullRequest[]; errors: Array<{ url: string; error: string }> }> {
  const store = new FilePullRequestStore(projectDirectory(project.project_id));
  const trackedPullRequests = await store.list();
  const monitoredPullRequests = trackedPullRequests.filter(
    (pullRequest) => pullRequest.monitoring_enabled
  );
  const errors: Array<{ url: string; error: string }> = [];
  for (const pullRequest of monitoredPullRequests) {
    try {
      await scanTrackedPullRequest(project, pullRequest);
    } catch (error) {
      errors.push({
        url: pullRequest.url,
        error: error instanceof Error ? error.message : "Unable to scan this pull request."
      });
    }
  }

  return {
    prs: await store.list(),
    errors
  };
}

function isCiRetryDue(lastRetryAt: string | null, now: Date): boolean {
  if (!lastRetryAt) {
    return true;
  }

  const lastRetryTime = new Date(lastRetryAt).valueOf();
  return Number.isNaN(lastRetryTime) || now.valueOf() - lastRetryTime >= CI_RETRY_INTERVAL_MS;
}
