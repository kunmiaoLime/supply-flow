import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  expandHomeDirectoryPath,
  inspectGitRepository,
  listGitBranches
} from "./repository-discovery.js";

const execFileAsync = promisify(execFile);

test("expands home directory path shorthand", () => {
  assert.equal(expandHomeDirectoryPath("~"), os.homedir());
  assert.equal(
    expandHomeDirectoryPath("~/code/supply-flow"),
    path.join(os.homedir(), "code", "supply-flow")
  );
  assert.equal(expandHomeDirectoryPath("/tmp/supply-flow"), "/tmp/supply-flow");
});

test("discovers a Git repository from its local path", async () => {
  const repositoryDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-repository-"));

  try {
    await runGit(repositoryDirectory, ["init"]);
    await runGit(repositoryDirectory, [
      "remote",
      "add",
      "origin",
      "git@github.com:lime/supply-flow.git"
    ]);

    assert.deepEqual(await inspectGitRepository(repositoryDirectory), {
      name: "supply-flow",
      remote: "git@github.com:lime/supply-flow.git",
      local: path.resolve(repositoryDirectory)
    });
  } finally {
    await rm(repositoryDirectory, { force: true, recursive: true });
  }
});

test("keeps a selected repository subdirectory as the local project path", async () => {
  const repositoryDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-repository-"));
  const projectDirectory = path.join(repositoryDirectory, "ios", "Apps", "Supply");

  try {
    await mkdir(projectDirectory, { recursive: true });
    await runGit(repositoryDirectory, ["init"]);
    await runGit(repositoryDirectory, [
      "remote",
      "add",
      "origin",
      "git@github.com:lime/supply.git"
    ]);

    assert.deepEqual(await inspectGitRepository(projectDirectory), {
      name: "supply",
      remote: "git@github.com:lime/supply.git",
      local: path.resolve(projectDirectory)
    });
  } finally {
    await rm(repositoryDirectory, { force: true, recursive: true });
  }
});

test("rejects a path that is not a Git repository", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-not-a-repository-"));

  try {
    await assert.rejects(
      inspectGitRepository(directory),
      /not inside a Git repository/
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("discovers a Git repository without an origin remote", async () => {
  const repositoryDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-no-origin-"));

  try {
    await runGit(repositoryDirectory, ["init"]);

    const local = path.resolve(repositoryDirectory);
    assert.deepEqual(await inspectGitRepository(repositoryDirectory), {
      name: path.basename(await realpath(repositoryDirectory)),
      remote: null,
      local
    });
  } finally {
    await rm(repositoryDirectory, { force: true, recursive: true });
  }
});

test("lists local Git branches for a selected repository scope", async () => {
  const repositoryDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-repository-"));
  const projectDirectory = path.join(repositoryDirectory, "ios", "Apps", "Supply");

  try {
    await mkdir(projectDirectory, { recursive: true });
    await runGit(repositoryDirectory, ["init", "-b", "master"]);
    await runGit(repositoryDirectory, ["config", "user.email", "test@example.com"]);
    await runGit(repositoryDirectory, ["config", "user.name", "Test User"]);
    await runGit(repositoryDirectory, ["commit", "--allow-empty", "-m", "Initial commit"]);
    await runGit(repositoryDirectory, ["branch", "feature/validated-ride"]);

    assert.deepEqual(await listGitBranches(projectDirectory), [
      "feature/validated-ride",
      "master"
    ]);
  } finally {
    await rm(repositoryDirectory, { force: true, recursive: true });
  }
});

async function runGit(workingDirectory: string, arguments_: string[]): Promise<void> {
  await execFileAsync("git", ["-C", workingDirectory, ...arguments_]);
}
