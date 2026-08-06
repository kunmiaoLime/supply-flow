import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BranchIndexSchema,
  isTrackableProjectBranchName,
  ProjectBranchSchema,
  type ProjectBranch
} from "@supply-flow/core/branch";

const BRANCH_INDEX_FILE = "branches.json";

export class FileBranchStore {
  public constructor(private readonly rootDirectory: string) {}

  public async list(): Promise<ProjectBranch[]> {
    try {
      return filterTrackableBranches(await this.readBranches());
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }

  public async initialize(): Promise<ProjectBranch[]> {
    try {
      const { branches, needsMigration } = await this.readBranchIndex();
      const trackableBranches = filterTrackableBranches(branches);
      if (trackableBranches.length !== branches.length || needsMigration) {
        await this.write(trackableBranches);
      }
      return trackableBranches;
    } catch (error) {
      if (isMissingFileError(error)) {
        await this.write([]);
        return [];
      }

      throw error;
    }
  }

  public async add(branch: ProjectBranch): Promise<ProjectBranch> {
    const parsedBranch = ProjectBranchSchema.parse(branch);
    assertTrackableBranch(parsedBranch);
    const branches = await this.list();
    if (branches.some((currentBranch) => isSameBranch(currentBranch, parsedBranch))) {
      throw new Error("This branch is already tracked for the selected repository.");
    }

    await this.write([...branches, parsedBranch]);
    return parsedBranch;
  }

  public async ensure(branch: ProjectBranch): Promise<{ branch: ProjectBranch; created: boolean }> {
    const parsedBranch = ProjectBranchSchema.parse(branch);
    assertTrackableBranch(parsedBranch);
    const branches = await this.list();
    const existingBranch = branches.find((currentBranch) => isSameBranch(currentBranch, parsedBranch));
    if (existingBranch) {
      return { branch: existingBranch, created: false };
    }

    await this.write([...branches, parsedBranch]);
    return { branch: parsedBranch, created: true };
  }

  public async update(current: ProjectBranch, next: ProjectBranch): Promise<ProjectBranch> {
    const parsedCurrent = ProjectBranchSchema.parse(current);
    const parsedNext = ProjectBranchSchema.parse(next);
    assertTrackableBranch(parsedNext);
    const branches = await this.list();
    const index = branches.findIndex((branch) => isSameBranch(branch, parsedCurrent));
    if (index === -1) {
      throw new Error("The tracked branch no longer exists.");
    }

    if (
      !isSameBranch(parsedCurrent, parsedNext) &&
      branches.some((branch) => isSameBranch(branch, parsedNext))
    ) {
      throw new Error("This branch is already tracked for the selected repository.");
    }

    const updatedBranches = [...branches];
    updatedBranches[index] = parsedNext;
    await this.write(updatedBranches);
    return parsedNext;
  }

  public async remove(branch: ProjectBranch): Promise<boolean> {
    const parsedBranch = ProjectBranchSchema.parse(branch);
    const branches = await this.list();
    const updatedBranches = branches.filter((currentBranch) => !isSameBranch(currentBranch, parsedBranch));
    if (updatedBranches.length === branches.length) {
      return false;
    }

    await this.write(updatedBranches);
    return true;
  }

  private indexPath(): string {
    return path.join(this.rootDirectory, BRANCH_INDEX_FILE);
  }

  private async readBranches(): Promise<ProjectBranch[]> {
    return (await this.readBranchIndex()).branches;
  }

  private async readBranchIndex(): Promise<{
    branches: ProjectBranch[];
    needsMigration: boolean;
  }> {
    const content = await readFile(this.indexPath(), "utf8");
    const rawIndex: unknown = JSON.parse(content);
    const parsedIndex = BranchIndexSchema.parse(rawIndex);

    return {
      branches: sortBranches(parsedIndex.branches),
      needsMigration: hasMissingOrchestrationFields(rawIndex)
    };
  }

  private async write(branches: ProjectBranch[]): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true });
    await writeJsonAtomically(this.indexPath(), {
      schemaVersion: 1,
      branches: sortBranches(branches)
    });
  }
}

function filterTrackableBranches(branches: ProjectBranch[]): ProjectBranch[] {
  return branches.filter((branch) => isTrackableProjectBranchName(branch.name));
}

function assertTrackableBranch(branch: ProjectBranch): void {
  if (!isTrackableProjectBranchName(branch.name)) {
    throw new Error("The main and master branches cannot be tracked.");
  }
}

function sortBranches(branches: ProjectBranch[]): ProjectBranch[] {
  return [...branches].sort(
    (first, second) =>
      first.repository_local.localeCompare(second.repository_local) || first.name.localeCompare(second.name)
  );
}

function isSameBranch(first: ProjectBranch, second: ProjectBranch): boolean {
  return first.name === second.name && first.repository_local === second.repository_local;
}

function hasMissingOrchestrationFields(value: unknown): boolean {
  if (
    typeof value !== "object" ||
    value === null ||
    !("branches" in value) ||
    !Array.isArray(value.branches)
  ) {
    return false;
  }

  return value.branches.some(
    (branch) =>
      typeof branch === "object" &&
      branch !== null &&
      !Array.isArray(branch) &&
      (!("review_result" in branch) ||
        !("implementation_session_id" in branch) ||
        !("review_session_id" in branch) ||
        !("review_state" in branch) ||
        !("auto_resolve" in branch))
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
