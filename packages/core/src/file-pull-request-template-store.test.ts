import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

test("lists, imports, and updates repository PR templates", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-templates-"));
  const templateDirectory = path.join(dataDirectory, "templates", "PR");

  try {
    const store = new FilePullRequestTemplateStore(dataDirectory);
    assert.deepEqual(await store.list(), []);

    const created = await store.create("LimeBike/android", "## Summary\n- Initial template\n");
    assert.deepEqual(created, {
      content: "## Summary\n- Initial template\n",
      path: path.join(templateDirectory, "limebike-android-pr-template.md"),
      repository: "limebike/android"
    });
    assert.deepEqual(await store.list(), [created]);
    await assert.rejects(
      store.create("limebike/android", "## Duplicate"),
      /already configured/
    );

    const updated = await store.update("limebike/android", "## Summary\n- Updated template\n");
    assert.deepEqual(updated, {
      ...created,
      content: "## Summary\n- Updated template\n"
    });
    assert.deepEqual(
      JSON.parse(await readFile(path.join(templateDirectory, "pr-template-mapping.json"), "utf8")),
      { "limebike/android": "limebike-android-pr-template.md" }
    );
    await assert.rejects(store.update("limebike/ios", "## Summary"), /No PR template/);
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
