import { FilePullRequestStore } from "@supply-flow/core/file-pull-request-store";
import {
  getGitHubPullRequestHealth,
  parseGitHubPullRequestUrl
} from "@supply-flow/core/github-pull-request";
import type { ProjectRecord } from "@supply-flow/core/project";
import type { ProjectPullRequest } from "@supply-flow/core/pull-request";
import { projectDirectory } from "../sessions/session-service";

export async function scanTrackedPullRequest(
  project: ProjectRecord,
  pullRequest: ProjectPullRequest
): Promise<ProjectPullRequest> {
  const reference = parseGitHubPullRequestUrl(pullRequest.url);
  if (!reference) {
    throw new Error("The tracked pull request link is invalid.");
  }

  const health = await getGitHubPullRequestHealth(reference);
  const updatedPullRequest: ProjectPullRequest = {
    ...pullRequest,
    monitoring_enabled:
      pullRequest.monitoring_enabled &&
      health.status !== "closed" &&
      health.status !== "merged",
    status: health.status,
    unresolved_comment_count: health.unresolvedCommentCount,
    unreplied_comment_count: health.unrepliedCommentCount,
    ci_status: health.ciStatus,
    last_scanned_at: new Date().toISOString()
  };

  return new FilePullRequestStore(projectDirectory(project.project_id)).update(
    pullRequest,
    updatedPullRequest
  );
}

export async function scanEnabledPullRequests(
  project: ProjectRecord
): Promise<{ prs: ProjectPullRequest[]; errors: Array<{ url: string; error: string }> }> {
  const store = new FilePullRequestStore(projectDirectory(project.project_id));
  const trackedPullRequests = await store.list();
  const monitoredPullRequests = trackedPullRequests.filter(
    (pullRequest) => pullRequest.monitoring_enabled
  );
  const results = await Promise.all(
    monitoredPullRequests.map(async (pullRequest) => {
      try {
        await scanTrackedPullRequest(project, pullRequest);
        return null;
      } catch (error) {
        return {
          url: pullRequest.url,
          error: error instanceof Error ? error.message : "Unable to scan this pull request."
        };
      }
    })
  );

  return {
    prs: await store.list(),
    errors: results.filter((result): result is { url: string; error: string } => result !== null)
  };
}
