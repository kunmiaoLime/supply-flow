import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ProjectRepository } from "@supply-flow/core/project";

const execFileAsync = promisify(execFile);

export class RepositoryInspectionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RepositoryInspectionError";
  }
}

export class RepositoryBranchError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RepositoryBranchError";
  }
}

export async function inspectGitRepository(localPath: string): Promise<ProjectRepository> {
  const expandedPath = expandHomeDirectoryPath(localPath.trim());
  if (!expandedPath) {
    throw new RepositoryInspectionError("Enter a local path.");
  }

  if (!path.isAbsolute(expandedPath)) {
    throw new RepositoryInspectionError('Enter an absolute local path or one starting with "~/".');
  }

  const local = path.resolve(expandedPath);
  const repositoryRoot = await runGit(
    local,
    ["rev-parse", "--show-toplevel"],
    "The local path is not inside a Git repository."
  );
  const remote = await originRemote(repositoryRoot);

  return {
    name: repositoryName(remote, repositoryRoot),
    remote,
    local
  };
}

export async function listGitBranches(localPath: string): Promise<string[]> {
  const local = normalizeLocalPath(localPath);

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", local, "for-each-ref", "--format=%(refname:short)", "refs/heads"],
      {
        encoding: "utf8",
        maxBuffer: 1_024 * 1_024
      }
    );
    return stdout
      .split("\n")
      .map((branch) => branch.trim())
      .filter(Boolean)
      .sort((first, second) => first.localeCompare(second));
  } catch {
    throw new RepositoryBranchError("The selected repository is not available as a Git repository.");
  }
}

export function expandHomeDirectoryPath(localPath: string): string {
  if (localPath === "~") {
    return os.homedir();
  }

  if (localPath.startsWith("~/") || localPath.startsWith("~\\")) {
    return path.join(os.homedir(), localPath.slice(2));
  }

  return localPath;
}

function normalizeLocalPath(localPath: string): string {
  const expandedPath = expandHomeDirectoryPath(localPath.trim());
  if (!expandedPath || !path.isAbsolute(expandedPath)) {
    throw new RepositoryBranchError("The selected repository path must be absolute.");
  }

  return path.resolve(expandedPath);
}

async function runGit(
  workingDirectory: string,
  arguments_: string[],
  failureMessage: string
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", workingDirectory, ...arguments_], {
      encoding: "utf8",
      maxBuffer: 1_024 * 1_024
    });
    const output = stdout.trim();

    if (!output) {
      throw new Error("Git command returned no output.");
    }

    return output;
  } catch {
    throw new RepositoryInspectionError(failureMessage);
  }
}

async function originRemote(workingDirectory: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", workingDirectory, "remote", "get-url", "origin"], {
      encoding: "utf8",
      maxBuffer: 1_024 * 1_024
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function repositoryName(remote: string | null, local: string): string {
  if (!remote) {
    return path.basename(local);
  }

  const normalizedRemote = remote.replace(/\/+$/, "").replace(/\.git$/, "");
  const name = normalizedRemote.split(/[/:]/).at(-1)?.trim();

  return name || path.basename(local);
}
