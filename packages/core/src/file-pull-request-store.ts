import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PullRequestIndexSchema,
  ProjectPullRequestSchema,
  type ProjectPullRequest,
  type ProjectPullRequestInput
} from "@supply-flow/core/pull-request";

const PULL_REQUEST_INDEX_FILE = "prs.json";
const mutationQueues = new Map<string, Promise<void>>();

export class FilePullRequestStore {
  public constructor(private readonly rootDirectory: string) {}

  public async list(): Promise<ProjectPullRequest[]> {
    try {
      const content = await readFile(this.indexPath(), "utf8");
      return sortPullRequests(PullRequestIndexSchema.parse(JSON.parse(content)).prs);
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }

  public async initialize(): Promise<ProjectPullRequest[]> {
    try {
      const content = await readFile(this.indexPath(), "utf8");
      return sortPullRequests(PullRequestIndexSchema.parse(JSON.parse(content)).prs);
    } catch (error) {
      if (isMissingFileError(error)) {
        await this.write([]);
        return [];
      }

      throw error;
    }
  }

  public async add(pullRequest: ProjectPullRequestInput): Promise<ProjectPullRequest> {
    const parsedPullRequest = ProjectPullRequestSchema.parse(pullRequest);
    const pullRequests = await this.list();
    if (pullRequests.some((currentPullRequest) => currentPullRequest.url === parsedPullRequest.url)) {
      throw new Error("This pull request is already tracked for the project.");
    }

    await this.write([...pullRequests, parsedPullRequest]);
    return parsedPullRequest;
  }

  public async update(
    current: ProjectPullRequest,
    next: ProjectPullRequest
  ): Promise<ProjectPullRequest> {
    const parsedCurrent = ProjectPullRequestSchema.parse(current);
    const parsedNext = ProjectPullRequestSchema.parse(next);
    return this.updateByUrl(parsedCurrent.url, () => parsedNext);
  }

  public async updateByUrl(
    url: string,
    update: (
      current: ProjectPullRequest
    ) => ProjectPullRequest | Promise<ProjectPullRequest>
  ): Promise<ProjectPullRequest> {
    return this.withMutationLock(async () => {
      const pullRequests = await this.list();
      const index = pullRequests.findIndex((pullRequest) => pullRequest.url === url);
      if (index === -1) {
        throw new Error("The tracked pull request no longer exists.");
      }

      const current = pullRequests[index];
      if (!current) {
        throw new Error("The tracked pull request no longer exists.");
      }

      const next = ProjectPullRequestSchema.parse(await update(current));
      if (
        url !== next.url &&
        pullRequests.some((pullRequest) => pullRequest.url === next.url)
      ) {
        throw new Error("This pull request is already tracked for the project.");
      }

      const updatedPullRequests = [...pullRequests];
      updatedPullRequests[index] = next;
      await this.write(updatedPullRequests);
      return next;
    });
  }

  public async remove(url: string): Promise<boolean> {
    const pullRequests = await this.list();
    const updatedPullRequests = pullRequests.filter(
      (currentPullRequest) => currentPullRequest.url !== url
    );
    if (updatedPullRequests.length === pullRequests.length) {
      return false;
    }

    await this.write(updatedPullRequests);
    return true;
  }

  private indexPath(): string {
    return path.join(this.rootDirectory, PULL_REQUEST_INDEX_FILE);
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const indexPath = this.indexPath();
    const previousMutation = mutationQueues.get(indexPath) ?? Promise.resolve();
    let releaseCurrentMutation!: () => void;
    const currentMutation = new Promise<void>((resolve) => {
      releaseCurrentMutation = resolve;
    });
    const queuedMutation = previousMutation.then(() => currentMutation);
    mutationQueues.set(indexPath, queuedMutation);

    await previousMutation;
    try {
      return await operation();
    } finally {
      releaseCurrentMutation();
      if (mutationQueues.get(indexPath) === queuedMutation) {
        mutationQueues.delete(indexPath);
      }
    }
  }

  private async write(pullRequests: ProjectPullRequest[]): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true });
    await writeJsonAtomically(this.indexPath(), {
      schemaVersion: 1,
      prs: sortPullRequests(pullRequests)
    });
  }
}

function sortPullRequests(pullRequests: ProjectPullRequest[]): ProjectPullRequest[] {
  return [...pullRequests].sort(
    (first, second) =>
      first.repository_local.localeCompare(second.repository_local) ||
      second.number - first.number ||
      first.url.localeCompare(second.url)
  );
}

async function writeJsonAtomically(targetPath: string, value: unknown): Promise<void> {
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, targetPath);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
