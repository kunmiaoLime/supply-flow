import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FilePullRequestTemplateStore,
  PullRequestTemplateError
} from "./file-pull-request-template-store.js";

test("resolves a local PR template from its GitHub repository mapping", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-templates-"));
  const templateDirectory = path.join(dataDirectory, "templates", "PR");

  try {
    await mkdir(templateDirectory, { recursive: true });
    await writeFile(
      path.join(templateDirectory, "pr-template-mapping.json"),
      JSON.stringify({ "limebike/ios": "ios-pr-template.md" }),
      "utf8"
    );
    await writeFile(
      path.join(templateDirectory, "ios-pr-template.md"),
      "## Summary\n- \n",
      "utf8"
    );

    assert.deepEqual(
      await new FilePullRequestTemplateStore(dataDirectory).resolve(
        "git@github.com:LimeBike/ios.git"
      ),
      {
        content: "## Summary\n- \n",
        path: path.join(templateDirectory, "ios-pr-template.md"),
        repository: "limebike/ios"
      }
    );
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("falls back when no local PR template matches the repository", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-templates-"));

  try {
    const store = new FilePullRequestTemplateStore(dataDirectory);
    assert.equal(await store.resolve("git@github.com:limebike/ios.git"), null);
    assert.equal(await store.resolve("git@gitlab.com:limebike/ios.git"), null);
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("rejects local PR templates that escape the template directory", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-templates-"));
  const templateDirectory = path.join(dataDirectory, "templates", "PR");

  try {
    await mkdir(templateDirectory, { recursive: true });
    await writeFile(
      path.join(templateDirectory, "pr-template-mapping.json"),
      JSON.stringify({ "limebike/ios": "../ios-pr-template.md" }),
      "utf8"
    );

    await assert.rejects(
      new FilePullRequestTemplateStore(dataDirectory).resolve("git@github.com:limebike/ios.git"),
      PullRequestTemplateError
    );
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
