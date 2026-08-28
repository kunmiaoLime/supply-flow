import type { ProjectBranch } from "@supply-flow/core/branch";
import { FileBranchStore } from "@supply-flow/core/file-branch-store";
import {
  findGitHubPullRequestForBranch,
  getGitHubPullRequestStatus,
  githubRepositoryFromRemote,
  GitHubPullRequestError
} from "@supply-flow/core/github-pull-request";
import type { ProjectRecord } from "@supply-flow/core/project";
import { projectDirectory } from "../sessions/session-service";

const activeBranchMergeChecks = new Map<string, Promise<BranchMergeStatusResult>>();

export interface BranchMergeStatusResult {
  branches: ProjectBranch[];
  errors: Array<{ branch: string; error: string }>;
}

export async function reconcileActiveBranchMergeStatus(
  project: ProjectRecord
): Promise<BranchMergeStatusResult> {
  const activeCheck = activeBranchMergeChecks.get(project.project_id);
  if (activeCheck) {
    return activeCheck;
  }

  const check = reconcileMergeStatus(project);
  activeBranchMergeChecks.set(project.project_id, check);
  try {
    return await check;
  } finally {
    if (activeBranchMergeChecks.get(project.project_id) === check) {
      activeBranchMergeChecks.delete(project.project_id);
    }
  }
}

async function reconcileMergeStatus(project: ProjectRecord): Promise<BranchMergeStatusResult> {
  const store = new FileBranchStore(projectDirectory(project.project_id));
  const activeBranches = (await store.initialize()).filter((branch) => !branch.merged);
  const errors: Array<{ branch: string; error: string }> = [];

  for (const branch of activeBranches) {
    const repository = project.repos.find(
      (candidate) => candidate.local === branch.repository_local
    );
    if (!repository || !githubRepositoryFromRemote(repository.remote)) {
      continue;
    }

    try {
      const pullRequest = await findGitHubPullRequestForBranch(repository.remote, branch.name);
      if ((await getGitHubPullRequestStatus(pullRequest)) === "merged") {
        await store.update(branch, { ...branch, merged: true });
      }
    } catch (error) {
      if (isMissingPullRequestError(error)) {
        continue;
      }
      errors.push({
        branch: branch.name,
        error: error instanceof Error ? error.message : "Unable to check whether the branch merged."
      });
    }
  }

  return {
    branches: await store.list(),
    errors
  };
}

function isMissingPullRequestError(error: unknown): error is GitHubPullRequestError {
  return error instanceof GitHubPullRequestError && error.status === 404;
}
